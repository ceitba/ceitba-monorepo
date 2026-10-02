import { useEffect, useState } from 'react'
import { getPinsState, loadPins, subscribe, type PinsState } from '../store/pinsStore'

// React binding for the pins store; loads the list on first use.
export function usePins(): PinsState {
  const [state, setState] = useState<PinsState>(getPinsState())
  useEffect(() => {
    const unsub = subscribe(setState)
    setState(getPinsState())
    void loadPins()
    return unsub
  }, [])
  return state
}
