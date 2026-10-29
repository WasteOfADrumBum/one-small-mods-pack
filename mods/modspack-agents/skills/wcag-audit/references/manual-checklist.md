# WCAG 2.2 AA manual checklist

Mark each item PASS, FAIL or NOT TESTED, per screen.

## Keyboard (2.1.1, 2.1.2, 2.4.3, 2.4.7, 2.4.11)

- [ ] Every interactive element is reachable with Tab and Shift+Tab, in a logical order.
- [ ] Every control works with Enter or Space (and arrow keys for composite widgets).
- [ ] No keyboard trap; Escape closes dialogs and menus and returns focus to the trigger.
- [ ] Focus is always visible, with at least 3:1 contrast, and never hidden behind sticky headers or overlays.
- [ ] A skip link reaches the main content.

## Screen reader (1.1.1, 1.3.1, 4.1.2, 4.1.3)

- [ ] Page title and one h1 describe the page; headings form an outline.
- [ ] Landmarks: header, nav, main, footer.
- [ ] Images have meaningful alt text, or empty alt when decorative.
- [ ] Buttons and links have names that make sense out of context.
- [ ] Status changes (search results count, saved, errors) are announced via a live region.
- [ ] Tested with: NVDA / JAWS / VoiceOver / TalkBack (name it), or NOT TESTED.

## Forms (1.3.5, 3.3.1, 3.3.2, 3.3.3, 3.3.7, 3.3.8)

- [ ] Every input has a visible label tied to it.
- [ ] Required fields and formats are stated before submission.
- [ ] Errors name the field and how to fix it, and move focus or announce.
- [ ] No re-entering information already given in the same process.
- [ ] Login does not depend on a cognitive test without an alternative.

## Visual (1.4.3, 1.4.4, 1.4.10, 1.4.11, 1.4.12, 1.4.13)

- [ ] Text contrast 4.5:1 (3:1 for large text); UI component and focus contrast 3:1.
- [ ] 200% zoom loses no content or function.
- [ ] 320 CSS px width: no horizontal scrolling for text content.
- [ ] Text spacing overrides do not clip text.
- [ ] Content shown on hover or focus can be dismissed and hovered.

## Motion and input (2.2.2, 2.3.3, 2.5.7, 2.5.8)

- [ ] prefers-reduced-motion removes non-essential animation.
- [ ] Anything that moves for more than 5 seconds can be paused.
- [ ] Dragging has a single-pointer alternative.
- [ ] Targets are at least 24 by 24 CSS px, or spaced to equivalent.

## Consistency (3.2.3, 3.2.4, 3.2.6)

- [ ] Navigation and help appear in the same place across pages.
- [ ] Components that do the same thing are named the same.
