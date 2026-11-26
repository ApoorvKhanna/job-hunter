'use client'

import Script from 'next/script'
import { useEffect, useState } from 'react'
import { GA_MEASUREMENT_ID, analyticsOn } from '@/lib/analytics'

/** Google Analytics (gtag.js), on the live site only. Page changes are counted
 *  by GA's enhanced measurement (history events). */
export function GoogleAnalytics() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    setOn(analyticsOn())
  }, [])
  if (!on) return null
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config','${GA_MEASUREMENT_ID}');`}
      </Script>
    </>
  )
}
