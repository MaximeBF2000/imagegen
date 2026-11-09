import type { AppConfig } from '../config.js';
import { ProviderError, type TextCompletionRequest, type TextProvider } from './types.js';

/**
 * Chat completion against any OpenAI-compatible endpoint: Ollama
 * (http://localhost:11434/v1, the default), LM Studio, vLLM, llama.cpp...
 * Unlike the local provider, vision models here can see reference images.
 */
export class OpenAICompatibleTextProvider implements TextProvider {
  readonly id = 'openai-compatible';
  readonly model: string;

  constructor(private readonly cfg: AppConfig['text']) {
    this.model = cfg.model;
  }

  readiness() {
    return null;
  }

  async complete(req: TextCompletionRequest): Promise<string> {
    const notReady = this.readiness();
    if (notReady) throw new ProviderError(notReady);

    const userContent = req.images?.length
      ? [
          { type: 'text', text: req.user },
          ...req.images.map((img) => ({
            type: 'image_url',
            image_url: { url: `data:${img.mime};base64,${img.data.toString('base64')}` },
          })),
        ]
      : req.user;

    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: req.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          temperature: req.temperature ?? 0.7,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: userContent },
          ],
        }),
      });
    } catch (err) {
      throw new ProviderError(`Network error contacting LLM: ${(err as Error).message}`, true);
    }

    const text = await res.text();
    if (!res.ok) {
      let message = text.slice(0, 400);
      try {
        message = JSON.parse(text)?.error?.message ?? message;
      } catch {
        /* not JSON */
      }
      throw new ProviderError(`LLM ${res.status}: ${message}`, res.status === 429 || res.status >= 500, res.status);
    }
    const content = JSON.parse(text)?.choices?.[0]?.message?.content;
    const out = Array.isArray(content) ? content.map((c: any) => c?.text ?? '').join('') : content;
    if (typeof out !== 'string' || !out.trim()) throw new ProviderError('LLM returned an empty response', true);
    // Reasoning models may prepend their thinking.
    return out.replace(/^[\s\S]*<\/think>/, '').trim();
  }
}
