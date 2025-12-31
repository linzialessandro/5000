import { DieFace } from "./types";

export const WINNING_SCORE = 5000;
export const NUM_DICE = 5;

export const FACES: DieFace[] = ['6', '7', 'J', 'Q', 'K', 'A'];

export const SCORES = {
  TRIPLE_A: 1000,
  TRIPLE_K: 500,
  TRIPLE_Q: 400,
  TRIPLE_J: 300,
  TRIPLE_7: 200,
  TRIPLE_6: 100,
  SINGLE_A: 100,
  SINGLE_K: 50,
};

// Colors matching the Florence aesthetic
export const COLORS = {
  PAPER: '#FDFBF7',
  ACCENT: '#F9E076',
  DANGER: '#FF8E8E',
  INTERACTION: '#6ABCB3',
  INK: '#4A4A4A',
  WHITE: '#FFFFFF',
};
