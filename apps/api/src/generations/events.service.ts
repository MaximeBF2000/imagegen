import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export type AppEvent =
  | { type: 'generation.changed'; generationId: string }
  | { type: 'generation.deleted'; generationId: string }
  | { type: 'folders.changed'; generationId?: undefined };

/** In-process event bus; the SSE endpoint turns these into client updates. */
@Injectable()
export class EventsService {
  readonly stream = new Subject<AppEvent>();

  generationChanged(generationId: string) {
    this.stream.next({ type: 'generation.changed', generationId });
  }

  generationDeleted(generationId: string) {
    this.stream.next({ type: 'generation.deleted', generationId });
  }

  foldersChanged() {
    this.stream.next({ type: 'folders.changed' });
  }
}
