import React, { useState, useEffect, useRef, useCallback } from 'react'; // Added useCallback
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
  // Refs for stars, paths, and SVG
  const star1Ref = useRef(null); // Keep this one
  const star2Ref = useRef(null); // Keep this one
  // Removed duplicate declarations below
  const actualPath1Ref = useRef(null); // Ref for the actual path element
  const actualPath2Ref = useRef(null);
  const svgRef = useRef(null);
  const animationFrameRef = useRef(null);
  // State for trail particles
  const [particles1, setParticles1] = useState([]); // Array of { id, x, y, timestamp }
  const [particles2, setParticles2] = useState([]);
  // State/Ref for animation timing and path data
  const animationStartTimeRef = useRef(null);
  const path1LengthRef = useRef(0);
  const path2LengthRef = useRef(0);

  // Use refs to store timeout IDs
  const explosionTimeoutRef = useRef(null);
  // Removed singularityShrunkTimeoutRef
  const completionTimeoutRef = useRef(null);
  const callbackTimeoutRef = useRef(null); // For delayed onAnimationComplete
  // Removed delayedExplosionCallbackRef

  // --- Trail Update Logic using getPointAtLength ---
  const MAX_TRAIL_PARTICLES = 30; // Max number of particles per trail
  const PARTICLE_LIFETIME = 500; // Particle fades out in 500ms
  const ANIMATION_DURATION = 3000; // Must match <animateMotion dur="3.0s"

  const updateTrails = useCallback(() => {
    const currentTime = performance.now(); // Get current time at the start

    // Ensure we are in the correct state and refs/data are ready
    if (
      animationState !== 'start' ||
      !actualPath1Ref.current ||
      !actualPath2Ref.current ||
      !animationStartTimeRef.current ||
      path1LengthRef.current === 0 ||
      path2LengthRef.current === 0
    ) {
      // Log why skipped, removed trailRef checks
      console.log(`Trail update skipped: State=${animationState}, ActualPath1Ready=${!!actualPath1Ref.current}, ActualPath2Ready=${!!actualPath2Ref.current}, StartTimeSet=${!!animationStartTimeRef.current}, Path1Length=${path1LengthRef.current}, Path2Length=${path2LengthRef.current}`);
      // If still in 'start' state but not ready, keep trying
      if (animationState === 'start') {
        animationFrameRef.current = requestAnimationFrame(updateTrails);
      } else {
         // If state changed, ensure loop stops
         if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
         }
         console.log("Trail update stopped: State changed or refs/data not ready.");
      }
      return;
    }

    const elapsedTime = currentTime - animationStartTimeRef.current;
    const progress = Math.min(elapsedTime / ANIMATION_DURATION, 1);

    // --- Calculate Position and Update Particles for Path 1 ---
    try {
        const length1 = path1LengthRef.current * progress;
        const point1 = actualPath1Ref.current.getPointAtLength(length1);
        setParticles1(prevParticles => {
            // Add new particle
            const newParticle = { id: currentTime + Math.random(), x: point1.x, y: point1.y, timestamp: currentTime };
            // Filter out old particles and limit count
            const updatedParticles = [
                newParticle,
                ...prevParticles.filter(p => currentTime - p.timestamp < PARTICLE_LIFETIME)
            ].slice(0, MAX_TRAIL_PARTICLES);
            return updatedParticles;
        });
    } catch(e) {
        console.error("Error updating particles for path 1:", e);
    }

    // --- Calculate Position and Update Particles for Path 2 ---
     try {
        const length2 = path2LengthRef.current * progress;
        const point2 = actualPath2Ref.current.getPointAtLength(length2);
         setParticles2(prevParticles => {
            // Add new particle
            const newParticle = { id: currentTime + Math.random() + 1, x: point2.x, y: point2.y, timestamp: currentTime }; // Ensure unique ID
            // Filter out old particles and limit count
            const updatedParticles = [
                newParticle,
                ...prevParticles.filter(p => currentTime - p.timestamp < PARTICLE_LIFETIME)
            ].slice(0, MAX_TRAIL_PARTICLES);
            return updatedParticles;
        });
     } catch(e) {
        console.error("Error updating particles for path 2:", e);
     }


    // Continue the loop if progress < 1 and state is still 'start'
    if (progress < 1 && animationState === 'start') {
      animationFrameRef.current = requestAnimationFrame(updateTrails);
    } else {
      console.log(`Trail update loop finished. Progress: ${progress}, State: ${animationState}`);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }
  }, [animationState]); // Dependency: animationState

  // Effect to find paths, calculate lengths, and start/stop the animation frame loop
  useEffect(() => {
    // Function to find paths and attempt length calculation
    const findPathsAndCalculateLengths = () => {
      if (!svgRef.current) {
        console.warn("SVG ref not available yet for path finding.");
        return false; // SVG not ready
      }

      let pathsFound = true;
      // Find path elements using ID within the SVG context
      if (!actualPath1Ref.current) {
        actualPath1Ref.current = svgRef.current.getElementById('spiralPath1');
        if (!actualPath1Ref.current) {
          console.error("Could not find path element with ID: spiralPath1");
          pathsFound = false;
        } else {
           console.log("Found path element #spiralPath1");
        }
      }
      if (!actualPath2Ref.current) {
        actualPath2Ref.current = svgRef.current.getElementById('spiralPath2');
        if (!actualPath2Ref.current) {
          console.error("Could not find path element with ID: spiralPath2");
          pathsFound = false;
        } else {
           console.log("Found path element #spiralPath2");
        }
      }

      if (!pathsFound) return false; // Stop if paths weren't found

      // Now attempt length calculation using the found elements
      let lengthsCalculated = true;
      if (actualPath1Ref.current && path1LengthRef.current === 0) {
          try {
              const length = actualPath1Ref.current.getTotalLength();
              if (length > 0) {
                  path1LengthRef.current = length;
                  console.log("Path 1 Length Calculated:", path1LengthRef.current);
              } else {
                  console.warn("Path 1 length calculated as 0. Path might not be ready or has no length.");
                  lengthsCalculated = false;
              }
          } catch(e) {
               console.error("Could not get path 1 length:", e);
               lengthsCalculated = false;
          }
      }
      if (actualPath2Ref.current && path2LengthRef.current === 0) {
           try {
              const length = actualPath2Ref.current.getTotalLength();
              if (length > 0) {
                  path2LengthRef.current = length;
                  console.log("Path 2 Length Calculated:", path2LengthRef.current);
              } else {
                  console.warn("Path 2 length calculated as 0. Path might not be ready or has no length.");
                  lengthsCalculated = false;
              }
           } catch(e) {
               console.error("Could not get path 2 length:", e);
               lengthsCalculated = false;
           }
      }
      return lengthsCalculated;
    };

    // Attempt finding paths and calculation immediately
    const initialCalculationSuccess = findPathsAndCalculateLengths();

    // Start/Stop logic based on animationState
    if (animationState === 'start') {
      console.log("Animation state is 'start'. Initiating trail updates.");
      // We only need to ensure lengths are calculated once.
      // The animation loop start logic remains similar.

      // If initial calculation failed (or paths weren't ready), try again shortly
      if (!initialCalculationSuccess) {
        const retryTimeout = setTimeout(() => {
          console.log("Retrying path finding and length calculation...");
          const retrySuccess = findPathsAndCalculateLengths();
          // Start animation loop after retry attempt
          if (!animationStartTimeRef.current) { // Avoid resetting time if already started
             animationStartTimeRef.current = performance.now();
             console.log(`Animation start time set (after retry). Path lengths ${retrySuccess ? 'calculated' : 'NOT calculated'}.`);
             if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
             animationFrameRef.current = requestAnimationFrame(updateTrails); // Start loop regardless, check handles missing lengths
          }
        }, 100); // Retry after 100ms
        return () => clearTimeout(retryTimeout); // Cleanup retry timeout
      }

      // If initial calculation was successful, start immediately
      if (initialCalculationSuccess && !animationStartTimeRef.current) {
          // Reset particle arrays
          setParticles1([]);
          setParticles2([]);
          // Record start time
          animationStartTimeRef.current = performance.now();
          console.log("Animation start time set.");
          // Start the animation loop
           if (animationFrameRef.current) {
              cancelAnimationFrame(animationFrameRef.current);
           }
          animationFrameRef.current = requestAnimationFrame(updateTrails);
      }
    } else {
      console.log(`Animation state is '${animationState}'. Stopping trail update loop.`);
      // Stop the animation loop if state is not 'start'
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }

    // Cleanup function for unmounting
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [animationState, updateTrails]); // Dependencies


  // --- Original useEffect for state transitions ---
  useEffect(() => {
    // Clear any previous timeouts
    clearTimeout(explosionTimeoutRef.current);
    // Removed singularityShrunkTimeoutRef clearing
    clearTimeout(completionTimeoutRef.current);
    clearTimeout(callbackTimeoutRef.current);
    // Removed delayedExplosionCallbackRef clearing

    // Define animation timings
    const orbitDuration = 3000; // Stars orbit for 3.0 seconds (Increased)
    // Removed explosionDelay
    const fadeOutDuration = 300; // Container fade out duration
    const postExplosionDuration = 100; // Reduced duration after collision
    
    // Set new timeouts
    // Trigger 'explode' state after orbit animation completes
    explosionTimeoutRef.current = setTimeout(() => {
      console.log("Setting animationState to 'explode'"); // Log state change
      setAnimationState('explode');

      // Trigger onExplosionStart immediately
      if (onExplosionStart) {
        console.log("Calling onExplosionStart immediately"); // Log callback
        onExplosionStart();
      }
      // Removed delayed callback logic

    }, orbitDuration); // Set 'explode' state after orbit duration

    // Removed singularityShrunkTimeout

    // Trigger 'complete' state after orbit + explosion effects + buffer
    completionTimeoutRef.current = setTimeout(() => {
      console.log("Setting animationState to 'complete'"); // Log state change
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
            // Removed delayedExplosionCallbackRef clearing
        };
        // Removed onSingularityShrunk from dependency array
    }, [onAnimationComplete, onExplosionStart]); // Keep original dependencies here


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
            ref={svgRef} // Add ref to SVG
            className="star-svg-container"
            viewBox="-200 -200 400 400" // Centered coordinate system
            preserveAspectRatio="xMidYMid meet"
        >
            <defs>
                {/* Refs are removed from here, paths are found by ID */}
                <path id="spiralPath1" d={spiralPath1} fill="none" stroke="none" />
                <path id="spiralPath2" d={spiralPath2} fill="none" stroke="none" />

                {/* Removed starTrailGlow filter */}

                {/* Gradient for the trail stroke - Attempting sharper fade for visual taper */}
                <linearGradient id="trailGradient" gradientUnits="userSpaceOnUse" x1="0%" y1="0%" x2="100%" y2="0%">
                    {/* Make the opaque part shorter and fade faster */}
                    {/* Note: userSpaceOnUse with x1/x2 might not follow the curve perfectly */}
                    <stop offset="0%" stopColor="rgba(255, 255, 255, 0.8)" />
                    <stop offset="25%" stopColor="rgba(220, 200, 255, 0.6)" /> {/* Start fading opacity earlier */}
                    <stop offset="75%" stopColor="rgba(180, 160, 220, 0.1)" /> {/* Become mostly transparent earlier */}
                    <stop offset="100%" stopColor="rgba(180, 160, 220, 0)" />
                </linearGradient>

                 {/* Optional Blur Filter for Trails */}
                <filter id="trailBlur" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="2" />
                </filter>

                {/* Removed ineffective mask definitions */}

                {/* SVG filter for Gravitational Lensing effect */}
                <filter id="gravitationalLens" x="-50%" y="-50%" width="200%" height="200%">
                    {/* Generate turbulence noise for displacement map */}
                    <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" result="turbulence"/>
                    {/* Use the turbulence as a displacement map */}
                    {/* Scale controls the intensity of the distortion */}
                    <feDisplacementMap in="SourceGraphic" in2="turbulence" scale="20" xChannelSelector="R" yChannelSelector="G" result="displaced"/>
                    {/* Optional: Add a slight blur to the distorted result */}
                    {/* <feGaussianBlur in="displaced" stdDeviation="1" result="blurredDisplacement"/> */}
                    {/* Merge the original graphic slightly visible underneath? Or just the displacement? */}
                    {/* Let's just show the displaced result for a strong effect */}
                    {/* <feMerge>
                        <feMergeNode in="blurredDisplacement"/>
                        <feMergeNode in="SourceGraphic" result="original"/>
                    </feMerge> */}
                </filter>
            </defs>

             {/* Render Trail Particles */}
             {/* Render particles1 */}
             {particles1.map(particle => (
                <circle
                    key={particle.id}
                    className="trail-particle trail-1" // Add specific class if needed
                    cx={particle.x}
                    cy={particle.y}
                    r="3" // Initial radius, CSS animation will handle shrinking
                    // Opacity and fill handled by CSS animation
                    style={{
                        // Pass timestamp to CSS for animation delay/timing if needed
                        // '--particle-age': (currentTime - particle.timestamp) / PARTICLE_LIFETIME // Example, might not be needed if animation starts immediately
                    }}
                />
             ))}
             {/* Render particles2 */}
             {particles2.map(particle => (
                <circle
                    key={particle.id}
                    className="trail-particle trail-2" // Add specific class if needed
                    cx={particle.x}
                    cy={particle.y}
                    r="3" // Initial radius
                    // Opacity and fill handled by CSS animation
                     style={{
                        // '--particle-age': (currentTime - particle.timestamp) / PARTICLE_LIFETIME
                    }}
                />
             ))}


            {/* Star 1 */}
            {/* Removed filter */}
            <circle ref={star1Ref} className="star star-1" r="9">
                {/* Animate along path1 */}
                {animationState === 'start' && (
                    <animateMotion dur="3.0s" fill="freeze" repeatCount="1"> {/* Increased duration */}
                        <mpath href="#spiralPath1" />
                    </animateMotion>
                )}
            </circle>

            {/* Star 2 */}
            {/* Removed filter */}
            <circle ref={star2Ref} className="star star-2" r="9">
                {/* Animate along path2 */}
                {animationState === 'start' && (
                    <animateMotion dur="3.0s" fill="freeze" repeatCount="1"> {/* Increased duration */}
                        <mpath href="#spiralPath2" />
                    </animateMotion>
                )}
            </circle>

            {/* Gravitational Lensing Effect Visualizer */}
        {/* This circle will appear at the center during explosion and apply the lens filter */}
        {/* We might need to apply the filter to the particles themselves later if this doesn't look right */}
        <circle
          className="gravitational-lens-effect"
          cx="0" cy="0" r="0" /* Starts with radius 0 */
          fill="none" /* No fill, the effect comes from the filter on whatever is behind it (or maybe a stroke) */
          stroke="rgba(255, 255, 255, 0.5)" /* Optional faint stroke */
          strokeWidth="2"
          filter="url(#gravitationalLens)"
          opacity="0" /* Start invisible */
        />
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
