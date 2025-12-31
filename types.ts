export type DieFace = '6' | '7' | 'J' | 'Q' | 'K' | 'A';

export interface Player {
  id: string;
  name: string;
  score: number;
}

export interface DieState {
  id: number;
  value: DieFace;
  isHeld: boolean; // Held from previous rolls in the same turn (banked into turn total)
  isScoring: boolean; // Part of the current winning combo
  justRolled: boolean; // For animation
}

export type GamePhase = 'SETUP' | 'PLAYING' | 'GAME_OVER';

export interface FloatingText {
  id: number;
  text: string;
  x: number;
  y: number;
  color: string;
}

export interface GameState {
  phase: GamePhase;
  players: Player[];
  currentPlayerIndex: number;
  dice: DieState[];
  turnAccumulatedScore: number; // Score from previous sub-rolls in this turn
  currentRollScore: number; // Score visible on the table right now
  rollCount: number; // How many times rolled this turn
  winner: Player | null;
  message: string | null; // "Farkle!", "Hot Dice!", etc.
}
