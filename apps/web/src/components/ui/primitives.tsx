'use client';

import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ChevronRight, X } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'glass';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent-gradient text-white shadow-[0_8px_24px_-8px_rgb(139_92_246/0.7)] hover:brightness-110 active:brightness-95 disabled:shadow-none',
  secondary: 'bg-surface-3 text-fg hover:bg-[#2a2a31] border border-line',
  ghost: 'text-muted hover:text-fg hover:bg-white/5',
  danger: 'text-danger hover:bg-danger/10',
  glass: 'bg-black/45 text-white backdrop-blur-md hover:bg-black/65 border border-white/10',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl font-medium',
  icon: 'h-9 w-9 rounded-lg',
  'icon-sm': 'h-8 w-8 rounded-lg',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium transition-all duration-150 select-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        'disabled:pointer-events-none disabled:opacity-40',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});

export function Tip({
  label,
  shortcut,
  side = 'top',
  children,
}: {
  label: React.ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          className="z-[100] flex items-center gap-2 rounded-md border border-line-strong bg-surface-3 px-2 py-1 text-xs text-fg shadow-xl animate-pop"
        >
          {label}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string; shortcut?: string; tipSide?: 'top' | 'bottom' | 'left' | 'right' }>(
  function IconButton({ label, shortcut, tipSide, size = 'icon', variant = 'ghost', ...props }, ref) {
    return (
      <Tip label={label} shortcut={shortcut} side={tipSide}>
        <Button ref={ref} aria-label={label} size={size} variant={variant} {...props} />
      </Tip>
    );
  },
);

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line-strong bg-white/5 px-1 font-mono text-[10px] text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Menu({
  trigger,
  children,
  align = 'end',
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'start' | 'end' | 'center';
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          className="z-[90] min-w-[190px] rounded-xl border border-line-strong bg-surface-2 p-1 shadow-2xl animate-pop"
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({
  icon,
  children,
  onSelect,
  danger,
  shortcut,
  disabled,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  shortcut?: string;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none data-[disabled]:opacity-40',
        danger ? 'text-danger data-[highlighted]:bg-danger/10' : 'text-fg data-[highlighted]:bg-white/6',
      )}
    >
      <span className="flex h-4 w-4 items-center justify-center text-muted [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <span className="flex-1">{children}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </DropdownMenu.Item>
  );
}

export const MenuSeparator = () => <DropdownMenu.Separator className="my-1 h-px bg-line" />;

export const MenuLabel = ({ children }: { children: React.ReactNode }) => (
  <DropdownMenu.Label className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">{children}</DropdownMenu.Label>
);

export function MenuSub({ icon, label, children }: { icon?: React.ReactNode; label: React.ReactNode; children: React.ReactNode }) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-fg outline-none data-[highlighted]:bg-white/6 data-[state=open]:bg-white/6">
        <span className="flex h-4 w-4 items-center justify-center text-muted [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        <span className="flex-1">{label}</span>
        <ChevronRight className="h-3.5 w-3.5 text-subtle" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          sideOffset={6}
          className="z-[95] max-h-[60vh] min-w-[200px] overflow-y-auto rounded-xl border border-line-strong bg-surface-2 p-1 shadow-2xl animate-pop"
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

/** Small centered dialog used for prompts/confirmations. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[70] w-[min(420px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line-strong bg-surface p-5 shadow-2xl outline-none animate-pop"
        >
          <div className="mb-4 flex items-start gap-3">
            <div className="flex-1">
              <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
              {description && <div className="mt-1 text-sm text-muted">{description}</div>}
            </div>
            <Dialog.Close className="-mr-1 -mt-1 flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-white/5 hover:text-fg">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Pop({
  trigger,
  children,
  align = 'start',
  side = 'top',
  className,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'start' | 'end' | 'center';
  side?: 'top' | 'bottom';
  className?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          side={side}
          sideOffset={8}
          className={cn('z-[90] rounded-xl border border-line-strong bg-surface-2 p-3 shadow-2xl animate-pop outline-none', className)}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
