import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  // The app has no dark mode (no ThemeProvider), so toasts default to light to match it
  const { theme = "light" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Bottom of the screen, lifted above the phone's gesture bar / home indicator.
      // At most three stacked (older ones collapse behind), each dismissed automatically.
      position="bottom-right"
      offset={{ bottom: "calc(env(safe-area-inset-bottom) + 24px)", right: "24px" }}
      mobileOffset={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)", left: "12px", right: "12px" }}
      visibleToasts={3}
      duration={4000}
      // Plain toasts use the app's colours through Sonner's variables (not Tailwind bg/text classes),
      // so richColors can still colour warnings red/amber and successes green.
      style={
        {
          "--normal-bg": "hsl(var(--background))",
          "--normal-text": "hsl(var(--foreground))",
          "--normal-border": "hsl(var(--border))",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "group toast group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
