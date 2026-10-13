import { describe, expect, it } from 'vitest'
import { stripSiteAds } from '@/services/songService'

describe('tab-site adverts in Guitar Pro texts', () => {
  it('keeps the name before a web address or advert phrase', () => {
    expect(stripSiteAds('示例歌手 www.example.cn 某某网为您提供优秀的谱子')).toBe('示例歌手')
    expect(stripSiteAds('示例歌手 - http://example.com')).toBe('示例歌手')
    expect(stripSiteAds('示例歌手')).toBe('示例歌手')
    expect(stripSiteAds('www.example.cn')).toBe('www.example.cn')
  })
})
