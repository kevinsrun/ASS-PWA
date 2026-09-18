// Invitation/reference language alone is not a personal obligation.
export function hasTaskInstruction(text: string) {
  if (
    /\b(?:example|historical|sample application|consider applying|if interested)\b/i.test(
      text,
    )
  )
    return false;
  return /\b(?:required|must|mandatory|due|deadline)\b|\b(?:please|you need to|you have to)\s+(?:complete|fill|submit|send|respond|reply|register|upload|return|apply|provide)|\b(?:send me (?:your|the) resume|apply by|application closes|registration closes|submit (?:the |your |this )?(?:form|application|essay|resume)|complete (?:the |your |this )?(?:application|form|questionnaire)|upload (?:the |your )?resume|respond with availability|RSVP by)\b/i.test(
    text,
  );
}
