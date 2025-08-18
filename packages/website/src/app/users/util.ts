export const getUserRatio = (
  ratio = 0
): 'contributor' | 'receiver' | 'neutral' => {
  if (ratio > 0) {
    return 'contributor'
  } else if (ratio <= -1) {
    return 'receiver'
  }

  return 'neutral'
}
