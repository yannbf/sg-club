import { useMemo } from 'react'
import { GameData } from '@/types'

export function useGameData(gameData: GameData[]) {
  const gameDataMap = useMemo(() => {
    const map = new Map<number, GameData>()

    gameData.forEach((game) => {
      if (game.app_id) {
        map.set(game.app_id, game)
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
