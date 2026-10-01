import { useState } from "react";
import { Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useCreateStandaloneProduct } from "@/lib/kashaf";

/** إضافة منتج يدويًا ليظهر كباقي المنتجات تمامًا. */
export function NewProductDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const create = useCreateStandaloneProduct();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      { name, description, image },
      {
        onSuccess: () => {
          toast.success("تمت إضافة المنتج.");
          setName("");
          setDescription("");
          setImage(null);
          setOpen(false);
        },
        onError: (err: Error) => toast.error(err.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" />
          منتج جديد
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>إضافة منتج جديد</DialogTitle>
            <DialogDescription>منتج يُضاف إلى قائمتك ويُعامل مثل باقي المنتجات.</DialogDescription>
          </DialogHeader>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="اسم المنتج"
            aria-label="اسم المنتج"
            autoFocus
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="وصف مختصر (اختياري)"
            aria-label="وصف المنتج"
            rows={3}
          />
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="new-product-image">
              صورة المنتج
            </label>
            <Input
              id="new-product-image"
              type="file"
              accept="image/*"
              onChange={(e) => setImage(e.target.files?.[0] ?? null)}
            />
            {image ? (
              <img
                src={URL.createObjectURL(image)}
                alt="معاينة صورة المنتج"
                className="h-24 w-24 rounded-md border object-cover"
              />
            ) : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {create.isPending ? "جارٍ الحفظ..." : "إضافة"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
