export const publicWhatsappPhone = '(82) 99644-3151'

export function publicWhatsappUrl(topic = 'o Barber System'): string {
  const message = `Oi! Vi o site do Barber System e queria saber mais sobre ${topic}.`
  return `https://wa.me/5582996443151?text=${encodeURIComponent(message)}`
}
