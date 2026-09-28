export function BrandMark({ tone = 'dark', className = '' }: { tone?: 'dark' | 'light'; className?: string }) {
  const background = tone === 'dark' ? '#10264A' : '#112B53'
  return <svg className={`brand-symbol ${className}`} viewBox="0 0 64 64" fill="none" role="img" aria-label="Símbolo Barber System" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="barber-system-pole"><rect x="23" y="14" width="18" height="36" rx="8"/></clipPath>
      <linearGradient id="barber-system-metal" x1="21" y1="10" x2="43" y2="53" gradientUnits="userSpaceOnUse"><stop stopColor="#F3F8FF"/><stop offset=".5" stopColor="#91B9F5"/><stop offset="1" stopColor="#E6F2FF"/></linearGradient>
    </defs>
    <rect x="2" y="2" width="60" height="60" rx="17" fill={background}/>
    <rect x="3" y="3" width="58" height="58" rx="16" stroke="#77B3FF" strokeOpacity=".42"/>
    <path d="M12 47.5C17.5 53.5 24.2 56 32 56s14.5-2.5 20-8.5" stroke="#68A8FF" strokeOpacity=".38" strokeWidth="1.6" strokeLinecap="round"/>
    <rect x="23" y="14" width="18" height="36" rx="8" fill="#F4F8FF"/>
    <g clipPath="url(#barber-system-pole)">
      <path d="M17 27 45 8M17 41 48 20M18 56 49 35" stroke="#377EE8" strokeWidth="7"/>
      <path d="M21 36 45 20M21 51 46 34" stroke="#9CC7FF" strokeWidth="2" strokeOpacity=".72"/>
    </g>
    <rect x="21" y="11" width="22" height="5" rx="2.5" fill="url(#barber-system-metal)"/>
    <rect x="21" y="48" width="22" height="5" rx="2.5" fill="url(#barber-system-metal)"/>
    <path d="M26 9h12M26 55h12" stroke="#C4DDFF" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
}

export function BrandLogo({ tone = 'dark', compact = false }: { tone?: 'dark' | 'light'; compact?: boolean }) {
  return <div className={`brand-lockup ${tone} ${compact ? 'compact' : ''}`}><BrandMark tone={tone}/><span className="brand-wordmark"><strong>BARBER</strong><b>SYSTEM</b></span></div>
}
