import React, { useState, useEffect, useRef } from 'react';
import './IntroAnimation.css';

// Pre-calculated SVG spiral paths (approximations)
// Path 1: Starts roughly top-left
const spiralPath1 = "M -180 -150 C -120 -200 180 -100 120 80 C 60 200 -150 100 -80 -40 C -40 -150 80 -50 30 20 C 0 60 -40 20 -10 0 C 10 -15 10 10 0 0";
// Path 2: Starts roughly bottom-right (180 deg rotated)
const spiralPath2 = "M 180 150 C 120 200 -180 100 -120 -80 C -60 -200 150 -100 80 40 C 40 150 -80 50 -30 -20 C 0 -60 40 -20 10 0 C -10 15 -10 -10 0 0";


// Removed onSingularityShrunk from props
const IntroAnimation = ({ onAnimationComplete, onExplosionStart }) => {
  // States: 'start', 'explode', 'complete'
  const [animationState, setAnimationState] = useState('start');
  // State to completely remove component after fade-out
  const [isFinished, setIsFinished] = useState(false);
  // Use refs to store timeout IDs
  const explosionTimeoutRef = useRef(null);
  // Removed singularityShrunkTimeoutRef
  const completionTimeoutRef = useRef(null);
  const callbackTimeoutRef = useRef(null); // For delayed onAnimationComplete
  const delayedExplosionCallbackRef = useRef(null); // Ref for delayed onExplosionStart callback

  useEffect(() => {
    // Clear any previous timeouts
    clearTimeout(explosionTimeoutRef.current);
    // Removed singularityShrunkTimeoutRef clearing
    clearTimeout(completionTimeoutRef.current);
    clearTimeout(callbackTimeoutRef.current);
    clearTimeout(delayedExplosionCallbackRef.current); // Clear delayed callback timeout

    // Define animation timings
    const orbitDuration = 3000; // Stars orbit for 3.0 seconds (Increased)
    const explosionDelay = 500; // Delay between explode state and background expansion start
    const fadeOutDuration = 300; // Container fade out duration
    const postExplosionDuration = 1000; // Approximate duration for particles/expansion after collision

    // Set new timeouts
    // Trigger 'explode' state after orbit animation completes
    explosionTimeoutRef.current = setTimeout(() => {
      setAnimationState('explode');

      // Delay the onExplosionStart callback to sync with background expansion animation
      delayedExplosionCallbackRef.current = setTimeout(() => {
        if (onExplosionStart) {
          onExplosionStart();
        }
      }, explosionDelay); // Delay matches the intended start of background expansion

    }, orbitDuration); // Set 'explode' state after orbit duration

    // Removed singularityShrunkTimeout

    // Trigger 'complete' state after orbit + explosion effects + buffer
    completionTimeoutRef.current = setTimeout(() => {
      setAnimationState('complete'); // Start fade-out

      // Schedule the onAnimationComplete callback *and* final removal *after* the fade-out duration
      callbackTimeoutRef.current = setTimeout(() => {
        setIsFinished(true); // Mark as finished to unmount
        if (onAnimationComplete) {
          onAnimationComplete();
        }
      }, fadeOutDuration); // Delay matches the fade-out duration in CSS

    }, orbitDuration + postExplosionDuration); // Trigger fade-out after orbit + explosion effects

    // Cleanup function: clear all timeouts
    return () => {
      clearTimeout(explosionTimeoutRef.current);
      // Removed singularityShrunkTimeoutRef clearing
      clearTimeout(completionTimeoutRef.current);
      clearTimeout(callbackTimeoutRef.current);
      clearTimeout(delayedExplosionCallbackRef.current); // Clear delayed callback timeout
    };
    // Removed onSingularityShrunk from dependency array
  }, [onAnimationComplete, onExplosionStart]);


  const containerClass = `intro-animation-container ${
    // Keep 'explode' class active once triggered (for particles and ::after)
    animationState === 'explode' || animationState === 'complete' ? 'explode' : ''
  } ${
    // Removed 'reveal' class logic
    // Add 'complete' class only when state is 'complete' to trigger container fade-out
    animationState === 'complete' ? 'complete' : ''
  }`;

  // No need for the explicit check for 'complete' state without callback,
  // the CSS handles visibility and interaction.

  // If finished, render nothing to completely remove from layout
  if (isFinished) {
    return null;
  }

  return (
    <div className={containerClass}>
      {/* SVG container for stars and animation paths */}
      <svg
        className="star-svg-container"
        viewBox="-200 -200 400 400" // Centered coordinate system
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <path id="spiralPath1" d={spiralPath1} fill="none" stroke="none" />
          <path id="spiralPath2" d={spiralPath2} fill="none" stroke="none" />

          {/* Define gradients or filters for glows if needed */}
          <filter id="starGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {/* Star 1 */}
        <circle className="star star-1" r="9"> {/* Removed filter="url(#starGlow)" */}
          {/* Animate along path1 */}
          {animationState === 'start' && (
             <animateMotion dur="3.0s" fill="freeze" repeatCount="1"> {/* Increased duration */}
               <mpath href="#spiralPath1" />
             </animateMotion>
          )}
        </circle>

        {/* Star 2 */}
        <circle className="star star-2" r="9"> {/* Removed filter="url(#starGlow)" */}
          {/* Animate along path2 */}
          {animationState === 'start' && (
            <animateMotion dur="3.0s" fill="freeze" repeatCount="1"> {/* Increased duration */}
              <mpath href="#spiralPath2" />
            </animateMotion>
          )}
        </circle>
      </svg>

      {/* Generate particles (adjust delays later in CSS) */}
      {/* Generate first wave of particles (outer) - Reduced Count */}
      {Array.from({ length: 200 }).map((_, i) => (
        <div
          key={`outer-${i}`}
          className="particle"
          style={{
            '--i': i,
            '--angle': `${Math.random() * 360}deg`,
            '--distance': `${30 + Math.random() * 60}vmax`,
            '--duration': `${1.5 + Math.random() * 1.0}s`,
            // Delay will be adjusted in CSS based on explode state
            '--base-delay': `${0.5 + Math.random() * 0.7}`, // Store base delay
          }}
        ></div>
      ))}
      {/* Generate second wave of particles (middle) - Reduced Count */}
      {Array.from({ length: 80 }).map((_, i) => (
        <div
          key={`middle-${i}`}
          className="particle middle-particle"
          style={{
            '--i': i,
            '--angle': `${Math.random() * 360}deg`,
            '--distance': `${15 + Math.random() * 15}vmax`,
            '--duration': `${1.2 + Math.random() * 0.8}s`,
            '--base-delay': `${1.0 + Math.random() * 0.5}`, // Store base delay
          }}
        ></div>
      ))}
      {/* Generate third wave of particles (inner) - Reduced Count */}
      {Array.from({ length: 40 }).map((_, i) => (
        <div
          key={`inner-${i}`}
          className="particle inner-particle"
          style={{
            '--i': i,
            '--angle': `${Math.random() * 360}deg`,
            '--distance': `${Math.random() * 15}vmax`,
            '--duration': `${1.0 + Math.random() * 0.6}s`,
            '--base-delay': `${1.4 + Math.random() * 0.4}`, // Store base delay
          }}
        ></div>
      ))}
    </div>
  );
};

export default IntroAnimation;
