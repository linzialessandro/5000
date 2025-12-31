import { DieFace, DieState } from "../types";
import { FACES, SCORES } from "../constants";

// Helper to get random face
export const getRandomFace = (): DieFace => {
  return FACES[Math.floor(Math.random() * FACES.length)];
};

// Calculate score for a set of faces
// Returns score and indices of dice that contributed to the score
export const calculateScore = (dice: DieState[]): { score: number; scoringIndices: number[] } => {
  // Only consider dice that are NOT held (currently active roll)
  const activeDice = dice.filter(d => !d.isHeld);
  const activeFaces = activeDice.map(d => d.value);
  const activeIndices = dice.map((d, i) => (!d.isHeld ? i : -1)).filter(i => i !== -1);
  
  const counts: Record<string, number> = {};
  FACES.forEach(f => counts[f] = 0);
  activeFaces.forEach(f => counts[f]++);

  let score = 0;
  const usedIndices = new Set<number>();

  // Check Triples First
  const triplesOrder: DieFace[] = ['A', 'K', 'Q', 'J', '7', '6'];
  
  triplesOrder.forEach(face => {
    if (counts[face] >= 3) {
      switch (face) {
        case 'A': score += SCORES.TRIPLE_A; break;
        case 'K': score += SCORES.TRIPLE_K; break;
        case 'Q': score += SCORES.TRIPLE_Q; break;
        case 'J': score += SCORES.TRIPLE_J; break;
        case '7': score += SCORES.TRIPLE_7; break;
        case '6': score += SCORES.TRIPLE_6; break;
      }
      counts[face] -= 3;
      
      // Mark 3 of these faces as used
      let found = 0;
      for (let i = 0; i < activeFaces.length; i++) {
        if (found < 3 && activeFaces[i] === face && !usedIndices.has(activeIndices[i])) {
          usedIndices.add(activeIndices[i]);
          found++;
        }
      }
    }
  });

  // Check Remaining Singles (A and K)
  // Logic: Only A and K score as singles
  if (counts['A'] > 0) {
    score += counts['A'] * SCORES.SINGLE_A;
    // Mark all remaining A's
    activeFaces.forEach((f, idx) => {
      if (f === 'A' && !usedIndices.has(activeIndices[idx])) {
        usedIndices.add(activeIndices[idx]);
      }
    });
  }

  if (counts['K'] > 0) {
    score += counts['K'] * SCORES.SINGLE_K;
    // Mark all remaining K's
    activeFaces.forEach((f, idx) => {
      if (f === 'K' && !usedIndices.has(activeIndices[idx])) {
        usedIndices.add(activeIndices[idx]);
      }
    });
  }

  return {
    score,
    scoringIndices: Array.from(usedIndices)
  };
};
