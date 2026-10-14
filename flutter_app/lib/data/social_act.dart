/// What is said to a person and not to a search box (`SocialAct` and
/// `Opener` in `src/lib/social.ts`). Its own file so the answer's sentences
/// (voice_lines.dart) and the chat's reader (salem_followup.dart) can both
/// name it without importing each other.
library;

enum SocialAct {
  salam,
  greet,
  morning,
  evening,
  how,
  thanks,
  afia,
  who,
  notShouq,
  help,
  bye,
  ok,
  no,
}

/// The four acts that can open a question: «هلا، أبي قهوة».
const Set<SocialAct> kOpeners = {
  SocialAct.salam,
  SocialAct.greet,
  SocialAct.morning,
  SocialAct.evening,
};

/// The web's key for each act's line in the clip library.
String socialKey(SocialAct act) => switch (act) {
  SocialAct.salam => 'social-salam',
  SocialAct.greet => 'social-greet',
  SocialAct.morning => 'social-morning',
  SocialAct.evening => 'social-evening',
  SocialAct.how => 'social-how',
  SocialAct.thanks => 'social-thanks',
  SocialAct.afia => 'social-afia',
  SocialAct.who => 'social-who',
  SocialAct.notShouq => 'social-not-shouq',
  SocialAct.help => 'social-help',
  SocialAct.bye => 'social-bye',
  SocialAct.ok => 'social-ok',
  SocialAct.no => 'social-no',
};

/// The act's name on the wire — the web's `SocialAct` string, which the
/// parity fixtures carry.
String socialName(SocialAct act) =>
    act == SocialAct.notShouq ? 'notShouq' : act.name;
