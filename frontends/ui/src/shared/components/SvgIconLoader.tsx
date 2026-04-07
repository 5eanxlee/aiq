'use client'

import { useEffect } from 'react'

export const SvgIconLoader = (): null => {
  useEffect(() => {
    void import('external-svg-loader')
  }, [])

  return null
}
