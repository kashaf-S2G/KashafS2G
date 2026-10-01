import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { storeSecretInVault } from "@/lib/secrets.functions";

/**
 * إدخال قيمة مفتاح خارجي مرة واحدة لتُحفظ في خزانة Supabase.
 * القيمة تُرسل إلى الخادم فقط ولا تُقرأ أو تُعرض مرة أخرى.
 */
export function VaultSecretDialog({ name, label }: { name: string; label: string }) {
  const queryClient = useQueryClient();
  const submit = useServerFn(storeSecretInVault);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  const mutation = useMutation({
    mutationFn: () => submit({ data: { name, value } }),
    onSuccess: () => {
      setValue("");
      setOpen(false);
      toast.success("تم حفظ المفتاح في الخزانة.");
      void queryClient.invalidateQueries({ queryKey: ["secrets-status"] });
    },
    onError: (error: Error) => toast.error(error.message || "تعذر حفظ المفتاح."),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setValue("");
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <KeyRound className="size-4" />
          حفظ في الخزانة
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            الصق القيمة مرة واحدة فقط. تُحفظ مشفّرة في خزانة Supabase ولن تُعرض بعد ذلك أبدًا.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`vault-${name}`} className="font-mono text-xs">
            {name}
          </Label>
          <Input
            id={`vault-${name}`}
            type="password"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="sk-..."
          />
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || value.trim().length < 20}>
            {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
