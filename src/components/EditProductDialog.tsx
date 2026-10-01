import { useState } from "react";
import { Pencil } from "lucide-react";
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
import { useUpdateProduct } from "@/lib/kashaf";
import type { ProductListItem as ProductSummary } from "@/lib/products-listing";

/** تعديل بيانات منتج موجود (الاسم والوصف والصورة). */
export function EditProductDialog({ product }: { product: ProductSummary }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? "");
  const [image, setImage] = useState<File | null>(null);
  const update = useUpdateProduct();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    update.mutate(
      { id: product.key, name, description, image, currentKey: product.key },
      {
        onSuccess: () => {
          toast.success("تم تحديث المنتج.");
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
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px] sm:h-8 sm:gap-1.5 sm:text-xs">
          <Pencil className="size-3.5 sm:size-4" />
          تعديل
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>تعديل المنتج</DialogTitle>
            <DialogDescription>حدّث اسم المنتج أو وصفه أو صورته.</DialogDescription>
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
            <label className="text-sm font-medium" htmlFor="edit-product-image">
              صورة جديدة (اختياري — تستبدل الحالية)
            </label>
            <Input
              id="edit-product-image"
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
            <Button type="submit" disabled={update.isPending || !name.trim()}>
              {update.isPending ? "جارٍ الحفظ..." : "حفظ التعديلات"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
