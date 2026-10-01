import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { extractAdDetails } from "@/lib/ad-extract.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteAdImage,
  friendlyError,
  signedImageUrl,
  uploadAdImage,
  useProductCodeOverrides,
  useSaveAd,
  useSaveProductCodeOverride,
  type AdRow,
  type CompetitorRow,
} from "@/lib/kashaf";
import { productCode, productKey } from "@/lib/product";

const today = () => new Date().toISOString().slice(0, 10);

export function AdDialog({
  open,
  onOpenChange,
  ad,
  competitors,
  defaultCompetitorId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ad?: AdRow | null | undefined;
  competitors: CompetitorRow[];
  defaultCompetitorId?: string | undefined;
}) {
  const save = useSaveAd();
  const saveCode = useSaveProductCodeOverride();
  const { data: codeOverrides } = useProductCodeOverrides();
  const [competitorId, setCompetitorId] = useState("");
  const [productName, setProductName] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [creationDate, setCreationDate] = useState(today());
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [endDate, setEndDate] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [adLink, setAdLink] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [suggestedNiche, setSuggestedNiche] = useState("");
  const extract = useServerFn(extractAdDetails);

  const analyzeLink = async () => {
    const value = adLink.trim();
    if (!value) {
      toast.error("ألصق رابط الإعلان أولًا");
      return;
    }
    setAnalyzing(true);
    try {
      const niches = Array.from(
        new Set(latest.current.competitors.map((p) => p.niche).filter(Boolean)),
      );
      const result = await extract({ data: { text: value, niches } });
      setProductName(result.product_name);
      if (result.product_description) setProductDescription(result.product_description);
      setCustomCode(productCode(result.product_name));
      setSuggestedNiche(result.niche);
      const match = latest.current.competitors.find((competitor) => competitor.niche === result.niche);
      if (!ad && match) setCompetitorId((current) => current || match.id);
      if (result.image_data_url) {
        setUploading(true);
        try {
          const blob = await (await fetch(result.image_data_url)).blob();
          const ext = blob.type.split("/")[1]?.split("+")[0] || "jpg";
          const file = new File([blob], `ad-${Date.now()}.${ext}`, { type: blob.type });
          const path = await uploadAdImage(file);
          setImageUrl(path);
          setPreviewUrl(await signedImageUrl(path));
        } catch {
          // نتجاهل فشل الصورة، تبقى البيانات النصية
        } finally {
          setUploading(false);
        }
      }
      toast.success("تم استخراج بيانات الإعلان");
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setAnalyzing(false);
    }
  };

  // إعادة تعبئة الحقول عند فتح النافذة أو تغيير الإعلان فقط،
  // حتى لا تُمسح القيم التي يكتبها المستخدم عند تحديث البيانات في الخلفية.
  const latest = useRef({ competitors, codeOverrides, defaultCompetitorId });
  latest.current = { competitors, codeOverrides, defaultCompetitorId };

  useEffect(() => {
    if (!open) return;
    const { competitors: list, codeOverrides: overrides, defaultCompetitorId: fallbackCompetitor } = latest.current;
    setCompetitorId(ad?.competitor_id ?? fallbackCompetitor ?? list[0]?.id ?? "");
    setProductName(ad?.product_name ?? "");
    setProductDescription(ad?.product_description ?? "");
    setCustomCode(
      ad ? (overrides?.get(productKey(ad.product_name)) ?? productCode(ad.product_name)) : "",
    );
    setCreationDate(ad?.creation_date ?? today());
    setStatus(ad?.status ?? "active");
    setEndDate(ad?.end_date ?? "");
    setImageUrl(ad?.image_url ?? null);
    setPreviewUrl(null);
    setAdLink("");
    setSuggestedNiche("");
    if (ad?.image_url) {
      signedImageUrl(ad.image_url).then((url) => setPreviewUrl(url));
    }
  }, [open, ad?.id]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("يرجى اختيار ملف صورة");
      return;
    }
    setUploading(true);
    try {
      const path = await uploadAdImage(file);
      const url = await signedImageUrl(path);
      setImageUrl(path);
      setPreviewUrl(url);
      toast.success("تم رفع الصورة");
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setUploading(false);
    }
  };

  const removeImage = async () => {
    if (imageUrl && imageUrl !== ad?.image_url) {
      await deleteAdImage(imageUrl).catch(() => {});
    }
    setImageUrl(null);
    setPreviewUrl(null);
  };

  const submit = async () => {
    if (!competitorId || !productName.trim() || !creationDate) {
      toast.error("يرجى تعبئة جميع الحقول المطلوبة");
      return;
    }
    if (status === "inactive" && !endDate) {
      toast.error("أدخل تاريخ الانتهاء للإعلان غير النشط");
      return;
    }
    try {
      if (ad?.image_url && imageUrl !== ad.image_url) {
        await deleteAdImage(ad.image_url).catch(() => {});
      }
      await save.mutateAsync({
        id: ad?.id,
        values: {
          competitor_id: competitorId,
          product_name: productName.trim(),
          product_description: productDescription.trim()
            ? productDescription.trim().split(/\s+/).slice(0, 20).join(" ")
            : null,
          creation_date: creationDate,
          end_date: status === "inactive" ? endDate : null,
          status,
          image_url: imageUrl,
        },
      });
      const key = productKey(productName);
      const trimmedCode = customCode.trim();
      if (key) {
        const autoCode = productCode(productName);
        if (trimmedCode && trimmedCode !== autoCode) {
          await saveCode.mutateAsync({ key, code: trimmedCode });
        } else if (codeOverrides?.has(key)) {
          await saveCode.mutateAsync({ key, code: null });
        }
      }
      toast.success(ad ? "تم تحديث الإعلان" : "تمت إضافة الإعلان");
      onOpenChange(false);
    } catch (error) {
      toast.error(friendlyError(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85dvh] overflow-y-auto overscroll-contain">
        <DialogHeader>
          <DialogTitle>{ad ? "تعديل الإعلان" : "إضافة إعلان"}</DialogTitle>
          <DialogDescription>الإعلان مرتبط بمنافس واحد.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <Label htmlFor="ad_link">رابط الإعلان (تعبئة تلقائية)</Label>
            <div className="flex gap-2">
              <Input
                id="ad_link"
                dir="ltr"
                value={adLink}
                onChange={(e) => setAdLink(e.target.value)}
                placeholder="ألصق رابط الإعلان هنا"
              />
              <Button type="button" variant="secondary" onClick={analyzeLink} disabled={analyzing}>
                <Sparkles className="size-4" />
                {analyzing ? "جارٍ التحليل..." : "تحليل"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {suggestedNiche
                ? `الفئة المقترحة: ${suggestedNiche}`
                : "يستخرج الذكاء الاصطناعي اسم المنتج والفئة من الرابط ويملأ الحقول تلقائيًا."}
            </p>
          </div>
          <div className="space-y-2">
            <Label>المنافس</Label>
            <Select value={competitorId} onValueChange={setCompetitorId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر المنافس" />
              </SelectTrigger>
              <SelectContent>
                {competitors.map((competitor) => (
                  <SelectItem key={competitor.id} value={competitor.id}>
                    {competitor.competitor_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="product_name">اسم المنتج</Label>
            <Input id="product_name" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="مثال: ساعة ذكية" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="product_description">وصف مختصر للمنتج</Label>
            <Textarea
              id="product_description"
              rows={2}
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              placeholder="جملة قصيرة تصف المنتج (20 كلمة كحد أقصى)"
            />
            <p className="text-xs text-muted-foreground leading-relaxed">
              {`${productDescription.trim() ? productDescription.trim().split(/\s+/).length : 0} / 20 كلمة`}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="product_code">معرف المنتج</Label>
            <Input
              id="product_code"
              dir="ltr"
              className="font-mono"
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value)}
              placeholder={productName.trim() ? productCode(productName) : "P-XXXX"}
            />
            <p className="text-xs text-muted-foreground leading-relaxed">
              اتركه كما هو للمعرف التلقائي، أو اكتب معرفك الخاص ليُستخدم في كل إعلانات هذا المنتج.
            </p>
          </div>
          <div className="space-y-2">
            <Label>صورة المنتج</Label>
            <div className="relative aspect-square overflow-hidden rounded-md border bg-muted">
              {previewUrl ? (
                <img src={previewUrl} alt={productName || "صورة المنتج"} className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  لا توجد صورة
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Label
                htmlFor="ad-image"
                className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
              >
                {uploading ? "جارٍ الرفع..." : "اختيار صورة"}
              </Label>
              <input
                id="ad-image"
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={handleFileChange}
                disabled={uploading}
              />
              {imageUrl ? (
                <Button type="button" variant="outline" size="sm" onClick={removeImage}>
                  إزالة الصورة
                </Button>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="creation_date">تاريخ إنشاء الإعلان</Label>
            <Input id="creation_date" type="date" dir="ltr" value={creationDate} onChange={(e) => setCreationDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>الحالة</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as "active" | "inactive")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">نشط</SelectItem>
                <SelectItem value="inactive">غير نشط</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {status === "inactive" ? (
            <div className="space-y-2">
              <Label htmlFor="end_date">تاريخ الانتهاء</Label>
              <Input id="end_date" type="date" dir="ltr" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
