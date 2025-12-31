import React, { useState, useEffect, useRef } from 'react';
import { GameState, Player, DieState, FloatingText } from './types';
import { NUM_DICE, WINNING_SCORE } from './constants';
import { SetupScreen } from './components/SetupScreen';
import { Dice } from './components/Dice';
import { WobblyButton } from './components/WobblyButton';
import { calculateScore, getRandomFace } from './utils/gameLogic';
import { PlayerCard } from './components/PlayerCard';

const App: React.FC = () => {
  // Initial State
  const [gameState, setGameState] = useState<GameState>({
    phase: 'SETUP',
    players: [],
    currentPlayerIndex: 0,
    dice: Array(NUM_DICE).fill(null).map((_, i) => ({ id: i, value: '6', isHeld: false, isScoring: false, justRolled: false })),
    turnAccumulatedScore: 0,
    currentRollScore: 0,
    rollCount: 0,
    winner: null,
    message: null,
  });
  
  const [rolling, setRolling] = useState(false);
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);
  const floatId = useRef(0);

  // Sound effects (simulated with vibration for mobile feeling)
  const vibrate = (pattern: number[]) => {
    if (navigator.vibrate) navigator.vibrate(pattern);
  };

  const addFloatingText = (text: string, x: number, y: number, color: string = '#4A4A4A') => {
    const id = floatId.current++;
    setFloatingTexts(prev => [...prev, { id, text, x, y, color }]);
    setTimeout(() => {
      setFloatingTexts(prev => prev.filter(ft => ft.id !== id));
    }, 2000);
  };

  const startGame = (names: string[]) => {
    const players: Player[] = names.map((name, i) => ({
      id: `p-${i}`,
      name,
      score: 0
    }));
    setGameState(prev => ({
      ...prev,
      phase: 'PLAYING',
      players,
      currentPlayerIndex: 0,
      turnAccumulatedScore: 0,
      currentRollScore: 0,
      rollCount: 0,
      message: "First Roll!",
      dice: Array(NUM_DICE).fill(null).map((_, i) => ({ id: i, value: '6', isHeld: false, isScoring: false, justRolled: false }))
    }));
  };

  const switchTurn = (nextIndex: number, players: Player[]) => {
    setGameState(prev => ({
      ...prev,
      players, // Updated scores passed in
      currentPlayerIndex: nextIndex,
      turnAccumulatedScore: 0,
      currentRollScore: 0,
      rollCount: 0,
      message: `${players[nextIndex].name}'s Turn`,
      dice: prev.dice.map(d => ({ ...d, isHeld: false, isScoring: false, justRolled: false }))
    }));
  };

  const handleRoll = () => {
    if (rolling) return;
    setRolling(true);
    vibrate([20]);

    // Animation delay
    setTimeout(() => {
      setGameState(prev => {
        // 1. Identify which dice to roll (not held)
        // If all dice are held (Hot Dice previously), reset all to unheld for new roll
        const allHeld = prev.dice.every(d => d.isHeld);
        const diceToRoll = allHeld 
          ? prev.dice.map(d => ({ ...d, isHeld: false })) 
          : prev.dice;

        // 2. Generate new values
        const newDice: DieState[] = diceToRoll.map(d => {
          if (d.isHeld) return { ...d, justRolled: false, isScoring: false };
          return {
            ...d,
            value: getRandomFace(),
            justRolled: true,
            isScoring: false // Reset scoring status, calculated below
          };
        });

        // 3. Calculate score of the newly rolled dice
        const { score, scoringIndices } = calculateScore(newDice);
        
        // 4. Update dice scoring status for visualization
        scoringIndices.forEach(idx => {
          newDice[idx].isScoring = true;
        });

        // 5. Check for FARKLE (0 score on non-held dice)
        let message = null;
        let turnAccumulatedScore = prev.turnAccumulatedScore;
        let currentRollScore = score;

        if (score === 0) {
          // FARKLE!
          message = "Farkle! 0 Points.";
          turnAccumulatedScore = 0;
          currentRollScore = 0;
          vibrate([50, 50, 50]);
        } else {
          // Valid roll
          // Check for Hot Dice (All dice scored)
          // Logic: Count total held dice + scoring dice in this roll
          const heldCount = newDice.filter(d => d.isHeld).length;
          const scoringCount = scoringIndices.length;
          
          if (heldCount + scoringCount === NUM_DICE) {
            message = "Hot Dice! Roll again!";
            // Important: In Hot Dice, the current roll score is added to accumulated immediately
            // and dice are essentially "reset" logically in the next roll action, 
            // but for now we just show them as scoring.
          }
        }

        return {
          ...prev,
          dice: newDice,
          currentRollScore,
          turnAccumulatedScore,
          message,
          rollCount: prev.rollCount + 1
        };
      });
      
      setRolling(false);
    }, 600);
  };

  const handleBank = () => {
    const { players, currentPlayerIndex, turnAccumulatedScore, currentRollScore, dice } = gameState;
    
    // Total potential points on the table right now
    const pointsToBank = turnAccumulatedScore + currentRollScore;
    
    if (pointsToBank === 0) {
      // If FARKLE was hit, just next player
      switchTurn((currentPlayerIndex + 1) % players.length, players);
      return;
    }

    // Identify current player
    const currentPlayer = players[currentPlayerIndex];
    let newTotal = currentPlayer.score + pointsToBank;
    let message = `Banked +${pointsToBank}`;
    let isWinner = false;

    // Rule: Exact 5000
    if (newTotal > WINNING_SCORE) {
      message = "Overshot! Bounced back.";
      newTotal = currentPlayer.score; // No change
      addFloatingText("Boomerang!", window.innerWidth / 2, window.innerHeight / 2, '#FF8E8E');
    } else if (newTotal === WINNING_SCORE) {
      isWinner = true;
    }

    // Rule: Bump
    const updatedPlayers = players.map((p, idx) => {
      if (idx === currentPlayerIndex) {
        return { ...p, score: newTotal };
      }
      // Check collision
      if (p.score === newTotal && newTotal !== 0 && !isWinner) {
        // BUMP!
        message = `Bumped ${p.name} to 0!`;
        addFloatingText("BUMP!", window.innerWidth / 2, window.innerHeight / 3, '#FF8E8E');
        vibrate([100, 50, 100]);
        return { ...p, score: 0 };
      }
      return p;
    });

    if (isWinner) {
      setGameState(prev => ({
        ...prev,
        phase: 'GAME_OVER',
        players: updatedPlayers,
        winner: updatedPlayers[currentPlayerIndex],
        message: `${updatedPlayers[currentPlayerIndex].name} Wins!`
      }));
    } else {
      // Rule: Hot Dice check for UI flow
      // If the user banks, their turn is over. 
      // EXCEPT if they have Hot Dice, they usually MUST roll. 
      // But usually "Banking" implies stopping. 
      // If you have Hot Dice, you CAN bank, or you can roll. 
      // If this function is called, they chose to stop.
      
      // Auto-hold logic update: Mark current scoring dice as held effectively before switching
      // (Visual only since we reset on switchTurn)
      
      addFloatingText(`+${pointsToBank}`, window.innerWidth / 2, window.innerHeight / 2, '#6ABCB3');
      switchTurn((currentPlayerIndex + 1) % players.length, updatedPlayers);
    }
  };

  // Helper to determine if we can bank
  // Can bank if currentRollScore > 0 OR (turnAccumulatedScore > 0 AND we haven't just farkled)
  // Farkle state is when score is 0 AND rollCount > 0 AND message includes "Farkle"
  const canBank = gameState.currentRollScore > 0 || (gameState.turnAccumulatedScore > 0 && !gameState.message?.includes("Farkle"));
  
  // Helper to determine if we can roll
  // Can roll if:
  // 1. It's the start of a turn (rollCount 0)
  // 2. We have scoring dice in the current roll (score > 0)
  // 3. We have Hot Dice (all dice are scoring/held)
  // Cannot roll if FARKLE.
  const isFarkle = gameState.message?.includes("Farkle");
  
  // Check if we have Hot Dice state
  const activeDice = gameState.dice.filter(d => !d.isHeld);
  // Get active scoring indices from logic
  const { scoringIndices } = calculateScore(gameState.dice);
  // How many dice are currently providing score (either held or currently rolling scoring)
  const scoringDiceCount = gameState.dice.filter(d => d.isHeld).length + scoringIndices.length;
  const isHotDice = scoringDiceCount === NUM_DICE && gameState.currentRollScore > 0;
  
  const canRoll = !isFarkle && (gameState.rollCount === 0 || gameState.currentRollScore > 0);

  // Auto-Move Held Dice Logic
  // When the user rolls, we need to "Bank" the *current roll's* score into *turnAccumulatedScore* 
  // and mark the scoring dice as held for the *next* roll logic.
  // The handleRoll function handles the randomization.
  // We need to intercept the Roll button to update state BEFORE rolling if it's not the first roll.
  const onRollClick = () => {
    if (gameState.rollCount > 0) {
      // Move current score to accumulated
      // Mark scoring dice as held
      const { scoringIndices } = calculateScore(gameState.dice);
      
      // If Hot Dice, we reset dice in handleRoll, but we need to accumulate score here
      setGameState(prev => {
        const nextAccumulated = prev.turnAccumulatedScore + prev.currentRollScore;
        const nextDice = prev.dice.map((d, i) => ({
           ...d,
           isHeld: d.isHeld || scoringIndices.includes(i)
        }));
        
        return {
          ...prev,
          turnAccumulatedScore: nextAccumulated,
          currentRollScore: 0, // Reset current roll score as it moved to accumulated
          dice: nextDice
        };
      });
      
      // Short delay to let state update before generating new dice
      setTimeout(handleRoll, 0);
    } else {
      handleRoll();
    }
  };


  if (gameState.phase === 'SETUP') {
    return (
      <div className="h-screen w-screen bg-paper overflow-hidden">
        <SetupScreen onStart={startGame} />
      </div>
    );
  }

  if (gameState.phase === 'GAME_OVER') {
    return (
      <div className="h-screen w-screen bg-paper flex flex-col items-center justify-center space-y-8 p-6 animate-fade-in text-center">
        <h1 className="text-5xl font-hand text-interaction mb-4">Winner!</h1>
        <div className="text-4xl font-bold text-ink">{gameState.winner?.name}</div>
        <div className="text-2xl text-gray-500">Score: {gameState.winner?.score}</div>
        <WobblyButton onClick={() => setGameState(prev => ({ ...prev, phase: 'SETUP' }))}>
          Play Again
        </WobblyButton>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-paper flex flex-col overflow-hidden select-none">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b-2 border-ink/5 bg-white/50 backdrop-blur-sm">
        <div className="flex flex-col">
          <span className="text-sm font-hand text-gray-400">Target</span>
          <span className="text-xl font-bold text-ink">5000</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-sm font-hand text-gray-400">Current Turn</span>
          <span className={`text-2xl font-bold ${isFarkle ? 'text-danger line-through' : 'text-interaction'}`}>
             +{gameState.turnAccumulatedScore + gameState.currentRollScore}
          </span>
        </div>
      </div>

      {/* Players Strip */}
      <div className="flex-none p-4 overflow-x-auto whitespace-nowrap space-x-4 no-scrollbar">
        {gameState.players.map((p, i) => (
          <div key={p.id} className="inline-block w-40">
            <PlayerCard 
              player={p} 
              isActive={i === gameState.currentPlayerIndex} 
              totalScore={p.score} 
            />
          </div>
        ))}
      </div>

      {/* Main Game Area */}
      <div className="flex-1 flex flex-col items-center justify-center relative">
        {/* Floating Texts */}
        {floatingTexts.map(ft => (
          <div
            key={ft.id}
            className="absolute text-4xl font-bold pointer-events-none animate-float z-50"
            style={{ left: ft.x, top: ft.y, color: ft.color }}
          >
            {ft.text}
          </div>
        ))}

        {/* Message Toast */}
        {gameState.message && (
           <div className={`mb-8 text-2xl font-hand font-bold animate-bounce ${isFarkle ? 'text-danger' : 'text-accent text-shadow'}`} style={{ textShadow: '1px 1px 0 #0002' }}>
             {gameState.message}
           </div>
        )}

        {/* Dice Tray */}
        <div className="flex flex-wrap justify-center gap-4 max-w-sm">
          {gameState.dice.map((die, i) => (
            <Dice key={die.id} die={die} index={i} rolling={rolling} />
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="p-6 pb-10 bg-white/30 backdrop-blur-md border-t-2 border-ink/5">
        <div className="flex justify-around items-center max-w-md mx-auto gap-4">
          
          <WobblyButton 
            onClick={isFarkle ? handleBank : onRollClick} 
            disabled={rolling || (!canRoll && !isFarkle)}
            variant={isFarkle ? "secondary" : "primary"}
            className="flex-1"
          >
            {isFarkle ? "Pass Dice" : (gameState.rollCount === 0 ? "Roll" : (isHotDice ? "Hot Dice Roll!" : "Roll Remaining"))}
          </WobblyButton>

          {!isFarkle && (
            <WobblyButton 
              onClick={handleBank} 
              disabled={rolling || !canBank}
              variant="secondary"
              className="flex-1"
            >
              Bank
            </WobblyButton>
          )}

        </div>
      </div>
    </div>
  );
};

export default App;
