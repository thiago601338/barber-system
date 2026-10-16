export function whatsappUrl(phone: unknown, message: string): string | null {
  let digits = String(phone || '').replace(/\D/g, '')
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`
  if (digits.length < 12 || digits.length > 15) return null
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}
