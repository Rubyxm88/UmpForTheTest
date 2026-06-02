# MVP Testing Plan
**Project:** UmpSim 3000  
**Date:** June 1, 2026  
**Scope:** Tasks 1-4, 6-7 (Team logos, Challenge modals, Summary screens, Stat hierarchy, Mobile responsiveness, Security)

---

## Testing Environments

### Devices to Test
- **Desktop:** 1280px+ (Chrome, Firefox)
- **Tablet:** 768px (iPad)
- **Mobile:** 375px (iPhone SE), 480px (larger phones)
- **Extra small:** 360px (older Android)

### Browsers
- Chrome (latest)
- Firefox (latest)  
- Safari (iOS if available)
- Edge (Windows)

---

## Task 1: Team Logo Display
**Changes:** Improved team name matching in `team-logos.js` and game data extraction

### Test Cases

#### 1.1 Team Logo Resolution (Desktop & Mobile)
- [ ] **Play Weekly Challenge** → Start a pitch
  - Verify pitcher team logo shows correctly in ab-start overlay
  - Verify batter team logo shows correctly
  - Compare against expected: Look at game title "Orioles vs. Tigers"
  - **Pass Criteria:** Logo matches expected team
  
- [ ] **Play Streak Challenge** → Complete a streak
  - Verify pitcher/batter logos in streak-summary-overlay
  - **Pass Criteria:** Logos correct on first appearance

- [ ] **Navigate to Profile** → Check favorite team selector
  - Change favorite team to different team
  - Verify logo updates immediately
  - **Pass Criteria:** Logo reflects selection

#### 1.2 Team Name Variations
- [ ] Test with different game titles:
  - "Orioles vs. Tigers" ✓
  - "Baltimore vs. Detroit" (if supported)
  - "Red Sox vs. Yankees" ✓
- [ ] **Pass Criteria:** All variations resolve to correct logos

#### 1.3 Leaderboard Team Display (Pre-Test 5)
- [ ] Navigate to Standings tab
- [ ] Verify team logos in leaderboard rows
- **Pass Criteria:** All logos match team abbreviations

---

## Task 2: Weekly Challenge Info Drill-Down
**Changes:** Redesigned modal for mobile-first layout

### Test Cases

#### 2.1 Modal Opens & Closes
- [ ] **Desktop (1280px)**
  - Click "ℹ️" button on Weekly Challenge card
  - Modal appears centered on screen
  - Can click outside to close
  - Can click ✕ button to close
  - Keyboard ESC closes modal
  - **Pass Criteria:** All methods work

- [ ] **Mobile (375px)**
  - Click "ℹ️" button
  - Modal appears as bottom-sheet (full-width)
  - Swipe down to close (if implemented)
  - Can tap outside to close
  - **Pass Criteria:** Responsive layout

#### 2.2 Content Display
- [ ] Modal shows:
  - [ ] Week number (e.g., "2026 · Week 22")
  - [ ] Challenge description
  - [ ] Stats grid: Games (5), At-bats (20), Progress (0/20), Resets (Monday)
  - [ ] At-bat list (scrollable) showing pitcher vs batter for each AB
  - [ ] Action buttons: Start, Standings, History
  
- [ ] **Pass Criteria:** All content visible, no text overflow, buttons clickable (44px+)

#### 2.3 Loading States
- [ ] Modal shows loading spinner while populating
- [ ] Spinner disappears when content loads
- [ ] Error handling: If load fails, displays "Could not load challenge details"
- **Pass Criteria:** No stuck loading states, clear feedback

#### 2.4 Mobile (375px) Specific
- [ ] No horizontal scroll
- [ ] Text is readable (not too small)
- [ ] At-bat list scrolls vertically without affecting modal
- [ ] Buttons are 44px+ height
- [ ] Spacing is compact but readable
- **Pass Criteria:** Fully functional on small screen

---

## Task 3: End-of-Challenge Screen
**Changes:** Mobile-optimized CSS for ab-summary-overlay and streak-summary-overlay

### Test Cases

#### 3.1 Layout & Responsiveness
- [ ] **Desktop (1280px)**
  - Complete a weekly challenge AB
  - Summary screen appears with arcade styling
  - All sections visible without scrolling (or scroll as needed)
  - Pitch chart toggle works (▶ PITCH CHART)
  
- [ ] **Mobile (375px)**
  - Complete an AB
  - Summary appears as bottom-sheet (full-width, not scaled)
  - No horizontal scroll
  - Header compact but readable
  - Score/accuracy/rank displayed prominently
  - Pitch chart can be toggled (▶ PITCH CHART button accessible)

- [ ] **Tablet (768px)**
  - Layout intermediate between mobile/desktop
  - Touch targets all 44px+
  - No layout shift

#### 3.2 Styling & Visual Hierarchy  
- [ ] Score displays large and prominent
- [ ] Accuracy % is highlighted (larger text, gold color)
- [ ] "YOU" vs "MLB UMP" comparison is clear
- [ ] XP earned badge stands out
- [ ] Next AT-BAT button is primary action (contrasts well)

#### 3.3 Content Visibility
- [ ] All sections visible:
  - [ ] Outcome badge (CORRECT/MISSED)
  - [ ] Pitcher vs Batter matchup
  - [ ] Call comparison (YOU vs MLB UMP)
  - [ ] XP earned
  - [ ] Weekly challenge progress (if applicable)
  - [ ] Action buttons
  
- [ ] **Pass Criteria:** No critical content hidden, readable text

#### 3.4 Functionality
- [ ] NEXT AT-BAT button advances to next pitch
- [ ] FILM/CARD links open in new tabs
- [ ] QUIT button returns to dashboard
- [ ] Pitch chart toggle expands/collapses review section
- [ ] All buttons responsive to touch
- **Pass Criteria:** All interactions work

---

## Task 4: Scoring & Stat Visual Hierarchy
**Changes:** CSS improvements to make metrics stand out

### Test Cases

#### 4.1 Summary Overlay Metrics
- [ ] **ab-summary-overlay:**
  - [ ] Score (YOU/MLB UMP) appears in large font (2rem clamp)
  - [ ] Accuracy % in gold/stitch color, bold
  - [ ] XP earned button stands out with border & glow
  
- [ ] **streak-summary-overlay:**
  - [ ] Final streak number large and prominent
  - [ ] Accuracy % in green, bold
  - [ ] All metrics readable at mobile size
  
- [ ] **Pass Criteria:** Metrics visually distinct from other content

#### 4.2 Profile Stats Page
- [ ] Navigate to Profile tab
- [ ] Stats grid shows:
  - [ ] Overall Accuracy (large, gold)
  - [ ] Peak Streak (large, gold)
  - [ ] Best Weekly Record (large, gold)
  - [ ] Pitches Called (large, gold)
- [ ] **Pass Criteria:** All values prominent and readable

#### 4.3 Leaderboard Display (Pre-Test 5)
- [ ] Navigate to Standings
- [ ] User rankings show score/stat prominently
- [ ] Compare user's accuracy with others
- **Pass Criteria:** Metrics stand out in leaderboard rows

---

## Task 6: Mobile Responsiveness
**Changes:** CSS for touch targets, text sizing, horizontal scroll prevention

### Test Cases

#### 6.1 Touch Target Size (44px minimum)
- [ ] **Mobile (375px)** - inspect each:
  - [ ] All buttons (ump-btn, ump-icon-btn)
  - [ ] Tab buttons (Play, Standings, Profile)
  - [ ] Input fields
  - [ ] Close buttons (✕)
  - [ ] Links and interactive elements
- [ ] **Pass Criteria:** All targets at least 44px height/width

#### 6.2 Text Sizing & Readability
- [ ] **Mobile (375px):**
  - [ ] Body text readable without zoom
  - [ ] Player names not cut off
  - [ ] Headers scale appropriately
  - [ ] Font sizes use clamp() for responsiveness
- [ ] **Extra small (360px):**
  - [ ] Text still readable (may be smaller)
  - [ ] No text overflow
- [ ] **Pass Criteria:** All text readable at 375px and 360px

#### 6.3 Horizontal Scroll Prevention
- [ ] **Mobile (375px):**
  - [ ] Dashboard tabs don't overflow
  - [ ] Leaderboard rows contained within viewport
  - [ ] Challenge cards fit without side scroll
  - [ ] No horizontal scrollbar appears
- [ ] **Pass Criteria:** Zero horizontal scroll anywhere

#### 6.4 Layout Stacking (Mobile)
- [ ] **Grid layouts stack to 1 column** at mobile width:
  - [ ] Challenge cards stack
  - [ ] Stats grid becomes single column on very small screens
  - [ ] Buttons stack appropriately
- [ ] **Pass Criteria:** Responsive layout transitions

#### 6.5 Modal Responsiveness
- [ ] **Challenge detail modal (Mobile 375px):**
  - [ ] Full-width bottom-sheet style
  - [ ] Scrolls vertically, not horizontally
  - [ ] Close button accessible
  - [ ] Content doesn't overflow bottom
  
- [ ] **Summary overlays (Mobile 375px):**
  - [ ] Full-width bottom-sheet
  - [ ] All sections scrollable
  - [ ] Buttons accessible at bottom
  
- [ ] **Pass Criteria:** All modals mobile-optimized

#### 6.6 Spacing & Padding (Mobile)
- [ ] **Mobile (375px):**
  - [ ] Padding reduced but not cramped
  - [ ] Gap between elements appropriate
  - [ ] No text touching edges
- [ ] **Pass Criteria:** Balanced spacing on small screens

---

## Task 7: Security & Logic (Verification)
**Changes:** Code review and documentation (no code changes for testing)

### Test Cases

#### 7.1 XSS Prevention
- [ ] **Player data doesn't render malicious content:**
  - Player names use `textContent` (verified in code)
  - Team logos use `.src` attribute
  - Stats are hardcoded by player name
- [ ] **Pass Criteria:** No HTML injection possible (verified via code review)

#### 7.2 Session Management
- [ ] **Login/Logout flow:**
  - [ ] Login creates session
  - [ ] Logout clears session
  - [ ] Can't access protected features without session
- [ ] **Pass Criteria:** Sessions work correctly

#### 7.3 Error Handling
- [ ] **API Errors handled gracefully:**
  - [ ] Network error → shows user-friendly message
  - [ ] Invalid stats → error logged, user notified
  - [ ] Server error → graceful fallback
- [ ] **Pass Criteria:** No unhandled exceptions in console

#### 7.4 Data Validation
- [ ] **Stats values are reasonable:**
  - [ ] Accuracy is 0-100%
  - [ ] XP is non-negative
  - [ ] Weekly progress doesn't exceed 20 ABs
  - [ ] Streak count is reasonable
- [ ] **Note:** Server-side validation needed pre-production
- [ ] **Pass Criteria:** Client prevents obviously invalid data

---

## Cross-Browser Testing

### Desktop Chrome/Firefox
- [ ] Challenge modal opens/closes
- [ ] Summary overlays render correctly
- [ ] Stats prominently displayed
- [ ] No console errors

### Mobile Safari (if available)
- [ ] Touch targets work
- [ ] Modal responsive
- [ ] No layout issues

### Edge/Firefox
- [ ] Same as Chrome
- [ ] CSS clamp() works (supported)

---

## Performance Checklist

- [ ] Modal opens smoothly (< 300ms)
- [ ] No layout shift when content loads
- [ ] Scroll is smooth (60fps)
- [ ] No console warnings about deprecated APIs
- [ ] Lighthouse score acceptable for mobile

---

## Sign-Off Checklist

After testing all sections:
- [ ] All test cases passed
- [ ] No critical issues found
- [ ] Mobile responsive working
- [ ] No regressions in existing features
- [ ] Ready for PR

---

## Known Limitations (Not Tested Yet)

**Task 5:** Leaderboard history/drill-down  
- Pending implementation and testing
- Will add to separate testing plan when ready

**Security Pre-Production:**
- Server-side stats validation needed (see SECURITY_AND_LOGIC_AUDIT.md)
- Rate-limiting configuration needed

---

## Notes for Tester

1. **Clear cache** between major test sections (Ctrl+Shift+Delete)
2. **Test with devtools open** to catch any errors
3. **Screenshot differences** between mobile/desktop for comparison
4. **Document any issues** with device/browser specifics
5. **Test on real devices** if possible (not just browser emulation)

---

**Next Steps:**
1. Complete testing on devices listed above
2. Document any issues found
3. Create GitHub PR with testing results
4. Address any failures found
5. Proceed to Task 5 (Leaderboard updates)
