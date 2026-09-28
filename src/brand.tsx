export function BrandMark({ tone = 'dark', className = '' }: { tone?: 'dark' | 'light'; className?: string }) {
  const background = tone === 'dark' ? '#dac49d' : '#172b24'
  const line = tone === 'dark' ? '#15251f' : '#ead6af'
  return <svg className={`brand-symbol ${className}`} viewBox="0 0 64 64" fill="none" role="img" aria-label="Símbolo Barber System" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="62" height="62" rx="14" fill={background}/>
    <rect x="5" y="5" width="54" height="54" rx="10" stroke={line} strokeOpacity=".3"/>
    <path d="M16 16V48M16 16H24.5C31.5 16 34.5 19.4 34.5 24.4C34.5 28.2 32.1 30.4 27.9 31.2M16 31.2H25C32.8 31.2 35.4 34.9 35.4 40C35.4 45 31.9 48 24.4 48H16" stroke={line} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M48.1 20.5C44.7 17.4 38.5 17.4 35.9 21.4C32.4 27 38 29.7 43.7 32.2C50.6 35.2 50.2 42.8 44.8 46.4C40.8 49.1 35.7 48.4 32.8 45.7" stroke={line} strokeWidth="3.4" strokeLinecap="round"/>
    <path d="M41.8 11.5H52.5M11.5 52.5H22.2" stroke={line} strokeWidth="1.7" strokeLinecap="round" strokeOpacity=".62"/>
  </svg>
}

export function BrandLogo({ tone = 'dark', compact = false }: { tone?: 'dark' | 'light'; compact?: boolean }) {
  return <div className={`brand-lockup ${tone} ${compact ? 'compact' : ''}`}><BrandMark tone={tone}/><span className="brand-wordmark"><strong>BARBER</strong><b>SYSTEM</b></span></div>
}
