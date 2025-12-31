<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 5000 - Sketches

A cozy, hand-drawn pass-and-play dice game inspired by Florence. First player to reach exactly 5000 points wins.

## Game Features
- **Hand-drawn Aesthetic:** Beautiful sketch-style UI with a paper texture.
- **Local Multiplayer:** Pass-and-play setup for 2 or more players.
- **Dynamic Scoring:** Real-time calculation of points based on dice combinations.
- **Competitive Rules:** Includes "Bumping" (sending others back to zero) and "Hot Dice" (extra rolls).

## How to Play
1. **Roll:** Roll the 5 dice to start your turn.
2. **Scoring:** 
   - **Triples:** Get three of a kind for big points (e.g., Triple 'A' is 1000 pts).
   - **Singles:** 'A' is worth 100 pts, 'K' is worth 50 pts.
3. **Bank or Roll:** After a scoring roll, you can either **Bank** your points to end your turn or **Roll Remaining** dice to try for more.
4. **Farkle:** If a roll contains no scoring dice, you lose all points accumulated in that turn!
5. **Hot Dice:** If all 5 dice contribute to your score, you can roll them all again and keep your accumulated points.
6. **Bumping:** If you bank your points and your new total matches another player's score, they are "bumped" back to 0!
7. **Winning:** You must reach **exactly 5000** points. If your bank takes you over 5000, you "boomerang" and your score remains unchanged for that turn.

## Getting Started

### Prerequisites
- **Node.js** (v18 or higher recommended)

### Installation
1.  **Clone the repository** (if applicable) or navigate to the project folder.
2.  **Install dependencies:**
    ```bash
    npm install
    ```

### Running Locally
To start the development server:
```bash
npm run dev
```
The app will be available at `http://localhost:3000`.
