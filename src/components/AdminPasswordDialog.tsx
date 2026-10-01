import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setAdminAccountPassword } from "@/lib/wallet.functions";

const TARGET_EMAIL = "bahthmontagat@gmail.com";

export function AdminPasswordDialog() {
  const submit = useServerFn(setAdminAccountPassword);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const mutation = useMutation({
    mutationFn: () => submit({ data: { password } }),
    onSuccess: () => {
      setPassword("");
      setConfirm("");
      setOpen(false);
      toast.success("تم تعيين كلمة المرور الجديدة بنجاح.");
    },
    onError: (error: Error) => toast.error(error.message || "تعذر تعيين كلمة المرور."),
  });

  function handleSubmit() {
    if (password.length < 8) {
      toast.error("كلمة المرور يجب ألا تقل عن 8 أحرف.");
      return;
    }
    if (password !== confirm) {
      toast.error("كلمتا المرور غير متطابقتين.");
      return;
    }
    mutation.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setPassword("");
          setConfirm("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <KeyRound />
          تعيين كلمة مرور الحساب الإداري
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="text-right sm:max-w-md">
        <DialogHeader className="text-right">
          <DialogTitle>تعيين كلمة مرور جديدة</DialogTitle>
          <DialogDescription>
            سيتم تعيين كلمة مرور جديدة للحساب التالي دون تغيير بريده الإلكتروني.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">البريد الإلكتروني للحساب</p>
            <p className="mt-1 break-all text-sm font-medium" dir="ltr">
              {TARGET_EMAIL}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-new-password">كلمة المرور الجديدة</Label>
            <Input
              id="admin-new-password"
              type="password"
              autoComplete="new-password"
              dir="ltr"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-confirm-password">تأكيد كلمة المرور</Label>
            <Input
              id="admin-confirm-password"
              type="password"
              autoComplete="new-password"
              dir="ltr"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button className="w-full sm:w-auto" disabled={mutation.isPending} onClick={handleSubmit}>
            {mutation.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
            تعيين كلمة المرور
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
