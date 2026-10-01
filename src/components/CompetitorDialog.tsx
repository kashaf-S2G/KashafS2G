import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PLATFORMS, friendlyError, useSaveCompetitor, type CompetitorRow } from "@/lib/kashaf";

export function CompetitorDialog({
  open,
  onOpenChange,
  competitor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  competitor?: CompetitorRow | null | undefined;
}) {
  const save = useSaveCompetitor();
  const [competitorName, setCompetitorName] = useState("");
  const [competitorUrl, setCompetitorUrl] = useState("");
  const [platform, setPlatform] = useState<string>("Facebook");
  const [niche, setNiche] = useState("");

  useEffect(() => {
    if (!open) return;
    setCompetitorName(competitor?.competitor_name ?? "");
    setCompetitorUrl(competitor?.competitor_url ?? "");
    setPlatform(competitor?.platform ?? "Facebook");
    setNiche(competitor?.niche ?? "");
  }, [open, competitor]);

  const submit = async () => {
    if (!competitorName.trim() || !competitorUrl.trim() || !niche.trim()) {
      toast.error("يرجى تعبئة جميع الحقول");
      return;
    }
    try {
      await save.mutateAsync({
        id: competitor?.id,
        values: {
          competitor_name: competitorName.trim(),
          competitor_url: competitorUrl.trim(),
          platform,
          niche: niche.trim(),
        },
      });
      toast.success(competitor ? "تم تحديث المنافس" : "تمت إضافة المنافس");
      onOpenChange(false);
    } catch (error) {
      toast.error(friendlyError(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{competitor ? "تعديل المنافس" : "إضافة منافس"}</DialogTitle>
          <DialogDescription>بيانات المنافس. الرابط لا يمكن تكراره.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="competitor_name">اسم المنافس</Label>
            <Input id="competitor_name" value={competitorName} onChange={(e) => setCompetitorName(e.target.value)} placeholder="مثال: متجر النخبة" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="competitor_url">رابط المنافس</Label>
            <Input id="competitor_url" dir="ltr" value={competitorUrl} onChange={(e) => setCompetitorUrl(e.target.value)} placeholder="https://facebook.com/..." />
          </div>
          <div className="space-y-2">
            <Label>المنصة</Label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger>
                <SelectValue placeholder="اختر المنصة" />
              </SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="niche">المجال (Niche)</Label>
            <Input id="niche" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="مثال: عبايات" />
          </div>
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
