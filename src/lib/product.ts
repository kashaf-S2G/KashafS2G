/** مفتاح ثابت للمنتج مبني على اسمه (يوحّد المسافات وحالة الأحرف). */
export function productKey(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** معرف مختصر ثابت للمنتج، نفسه لو تكرر المنتج في إعلانات مختلفة. */
export function productCode(name: string) {
  const key = productKey(name);
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 1679616; // 36^4
  }
  return `P-${hash.toString(36).toUpperCase().padStart(4, "0")}`;
}
