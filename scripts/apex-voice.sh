#!/bin/bash
# apex-voice — show an OS-level prompt asking for the command, then run apex.
# Bind this to a global hotkey OR call via "Hey Siri, APEX" shortcut.

set -e

# Prompt the user for a command (dialog box — no dictation required, but
# macOS speech-to-text works in the text field if enabled)
CMD=$(/usr/bin/osascript -e 'text returned of (display dialog "What do you want APEX to do?" default answer "" buttons {"Cancel","Go"} default button "Go" with icon note giving up after 30)' 2>/dev/null)

if [ -z "$CMD" ]; then
  /usr/bin/osascript -e 'display notification "No command given" with title "APEX"'
  exit 0
fi

# Run the command, capture the spoken response
OUTPUT=$(/Users/samjames/bin/apex "$CMD" 2>&1 || true)

# Show as notification AND speak it
/usr/bin/osascript -e "display notification \"$OUTPUT\" with title \"APEX\""
/usr/bin/say "$OUTPUT" &
