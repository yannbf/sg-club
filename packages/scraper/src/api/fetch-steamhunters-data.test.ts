import { describe, expect, it } from 'vitest'

import { parseTagsByApiName } from './fetch-steamhunters-data'

const ach = (fields: string, tagVotes: string) =>
  `{"appId":1,${fields},"name":"n","displayName":"n","hidden":false,"tagVotes":${tagVotes},"url":"/x"}`

describe('parseTagsByApiName', () => {
  it('reads the current page format: extra keys before apiName and dlcAppIds arrays', () => {
    const html = [
      '"updates":[',
      '{"updateId":1,"updateNumber":0,"displayReleaseDate":new Date(1),"dlcAppIds":[],"inserted":new Date(2)},',
      '{"updateId":2,"updateNumber":1,"version":"1.0","dlcAppIds":[555],"inserted":new Date(3)}',
      '],"achievements":[',
      ach('"achievementId":1,"updateId":1,"internalKey":256,"index":0,"apiName":"story_end"', '[{"tagId":3}]'),
      ',',
      ach('"achievementId":2,"updateId":1,"internalKey":257,"index":1,"apiName":"side_quest"', '[{"tagId":14}]'),
      ',',
      ach('"achievementId":3,"updateId":2,"internalKey":258,"index":2,"apiName":"dlc_end"', '[{"tagId":1},{"tagId":3}]'),
      ']',
    ].join('')

    expect(parseTagsByApiName(html)).toEqual([
      { apiName: 'story_end', isDlc: false, isLaterUpdate: false },
      { apiName: 'dlc_end', isDlc: true, isLaterUpdate: true },
    ])
  })

  it('still reads the older format with a single dlcAppId key and no internalKey', () => {
    const html = [
      '"updates":[',
      '{"updateId":0,"updateNumber":0,"inserted":new Date(1)},',
      '{"updateId":1,"updateNumber":1,"dlcAppId":777,"inserted":new Date(2)}',
      '],"achievements":[',
      ach('"achievementId":1,"updateId":0,"index":0,"apiName":"the_end"', '[{"tagId":3}]'),
      ',',
      ach('"achievementId":2,"updateId":1,"index":1,"apiName":"dlc_done"', '[{"tagId":3}]'),
      ']',
    ].join('')

    expect(parseTagsByApiName(html)).toEqual([
      { apiName: 'the_end', isDlc: false, isLaterUpdate: false },
      { apiName: 'dlc_done', isDlc: true, isLaterUpdate: true },
    ])
  })

  it('returns no candidates when nothing carries the Main Storyline tag', () => {
    const html =
      '"updates":[{"updateId":0,"updateNumber":0,"dlcAppIds":[]}],"achievements":[' +
      ach('"achievementId":1,"updateId":0,"internalKey":1,"index":0,"apiName":"a"', '[]') +
      ']'
    expect(parseTagsByApiName(html)).toEqual([])
  })
})
