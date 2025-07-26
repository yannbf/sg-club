'use client'

import { useState, useEffect, useMemo } from 'react'
import { GameData } from '@/types'

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

export function useGameData(gameData: GameData[] | undefined) {
  const gameDataMap = useMemo(() => {
    const map = new Map<number, GameData>()

    gameData?.forEach((game) => {
      const id = game.app_id ?? game.package_id
      if (id) {
        map.set(id, game)
      }
    })

    return map
  }, [gameData])

  const getGameData = (appId: number | null | undefined) => {
    if (!appId) return null
    return gameDataMap.get(appId) || null
  }

  return {
    getGameData,
    gameDataMap,
  }
}
