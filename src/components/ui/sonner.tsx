import { Toaster as Sonner, type ToasterProps } from 'sonner';

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:rounded-xl group-[.toaster]:border group-[.toaster]:border-border/60 group-[.toaster]:bg-card/95 group-[.toaster]:text-foreground group-[.toaster]:shadow-xl group-[.toaster]:backdrop-blur-md',
          title: 'group-[.toast]:text-foreground group-[.toast]:font-medium',
          description: 'group-[.toast]:text-muted-foreground',
          success:
            'group-[.toast]:border-emerald-500/30 group-[.toast]:bg-emerald-500/10 group-[.toast]:text-emerald-200',
          error: 'group-[.toast]:border-rose-500/30 group-[.toast]:bg-rose-500/10 group-[.toast]:text-rose-200',
          warning: 'group-[.toast]:border-amber-500/30 group-[.toast]:bg-amber-500/10 group-[.toast]:text-amber-200',
          info: 'group-[.toast]:border-sky-500/30 group-[.toast]:bg-sky-500/10 group-[.toast]:text-sky-200',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
          closeButton:
            'group-[.toast]:border-border/60 group-[.toast]:bg-background/60 group-[.toast]:text-muted-foreground group-[.toast]:hover:text-foreground',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
