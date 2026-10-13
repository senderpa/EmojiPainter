import type { InfoLanguage } from './infoCopy';

/** Public policy page containing Emoji Painter's privacy policy and Terms of Use. */
export const PROFILE_TERMS_WEB_URL = 'https://emojipainter.com/privacy_policy.html';

export interface ProfileTermsCopy {
  title: string;
  intro: string;
  consentTitle: string;
  consentBody: string;
  acceptLabel: string;
  contentLicenceTitle: string;
  contentLicenceBody: string;
  openReaderLabel: string;
  closeLabel: string;
  privacyButtonLabel: string;
  deleteButtonLabel: string;
  syncFoundTitle: string;
  syncFoundBody: string;
  syncLabel: string;
  newLabel: string;
  deleteLabel: string;
  sections: { heading: string; body: string[] }[];
}

const en: ProfileTermsCopy = {
  title: 'Profil Studio Terms & Privacy',
  intro:
    'Profil Studio stores only abstract device-linked identifiers, passport totals, passport names chosen by the player, and gallery-linked passport images needed to restore your profile.',
  consentTitle: 'Use of Profil Studio',
  consentBody:
    'Before you use Profil Studio, please read and accept these terms. You can reopen them later, switch languages, or request profile deletion from the server settings area.',
  acceptLabel: 'Accept Profil Studio Terms',
  contentLicenceTitle: '6. Public gallery content licence',
  contentLicenceBody:
    'You keep any rights you legally hold in your artwork. Before a public upload, you confirm that you have the necessary rights to upload it and grant Emoji Painter a worldwide, non-exclusive, royalty-free licence to host, store, reproduce, display, distribute, moderate, promote, and continue displaying that gallery submission. This licence may continue after profile deletion for content already submitted publicly. Profile deletion anonymizes retained submissions. Emoji Painter may remove content at its discretion. Contact Support for exceptional content-removal enquiries.',
  openReaderLabel: 'Read Terms',
  closeLabel: 'Close',
  privacyButtonLabel: 'Privacy & AGB',
  deleteButtonLabel: 'Delete Profile From Server',
  syncFoundTitle: 'Server profile found',
  syncFoundBody:
    'A profile with your device ID was found on the server. You can sync the saved name and portrait history, start fresh on this device, or delete the server profile first.',
  syncLabel: 'Sync',
  newLabel: 'Start New',
  deleteLabel: 'Delete on Server',
  sections: [
    {
      heading: '1. What we store',
      body: [
        'Profil Studio stores a random device-linked identifier, your chosen passport name, accumulated points or coins, stroke and time totals, and passport images you publish to the gallery.',
        'The system is designed to avoid storing directly identifying real-world data such as legal names, postal addresses, or phone numbers unless you choose to type such data into your own profile name.',
      ],
    },
    {
      heading: '2. Purpose of processing',
      body: [
        'The stored data is used only to restore your profile, display your public passport in the gallery or leaderboard, and keep your passport statistics in sync between local storage and the server.',
        'The data is not sold, rented, or handed over for advertising purposes.',
      ],
    },
    {
      heading: '3. Public visibility',
      body: [
        'If you upload to the live gallery, your passport name, passport portrait, and gallery contribution may be visible to other players.',
        'Do not use Profil Studio to upload sensitive personal data or images that you do not want to appear publicly.',
      ],
    },
    {
      heading: '4. Legal basis and consent',
      body: [
        'For features that require server storage, use is based on your consent and on the technical necessity of storing profile records so the feature can function.',
        'You may withdraw consent at any time by deleting the server profile and starting a new local profile.',
      ],
    },
    {
      heading: '5. Your controls',
      body: [
        'You can sync an existing server profile back to a fresh install, keep a new local profile with a regenerated device ID, or request deletion of the server profile when the deletion endpoint is available.',
        'Deleting the app alone may remove local data while leaving server-side public profile data online until you sync or delete it explicitly.',
      ],
    },
    {
      heading: '6. Public gallery content licence',
      body: [
        'You keep any rights you legally hold in your artwork. Before uploading public gallery content, you confirm that you have the necessary rights to upload it.',
        'You grant Emoji Painter a worldwide, non-exclusive, royalty-free licence to host, store, reproduce, display, distribute, moderate, promote, and continue displaying gallery submissions. This licence may continue after profile deletion for content already submitted publicly; deletion anonymizes retained submissions.',
        'Emoji Painter may remove content at its discretion. Contact Support for exceptional content-removal enquiries.',
      ],
    },
  ],
};

const de: ProfileTermsCopy = {
  title: 'Profil-Studio AGB & Datenschutz',
  intro:
    'Das Profil Studio speichert nur abstrakte, geraetebezogene Kennungen, Profilsummen, selbst gewaehltе Passnamen und passbezogene Galerie-Bilder, die fuer die Wiederherstellung des Profils noetig sind.',
  consentTitle: 'Nutzung des Profil Studios',
  consentBody:
    'Bitte lies diese Bedingungen vor der Nutzung des Profil Studios und stimme ihnen zu. Du kannst sie spaeter erneut oeffnen, die Sprache wechseln oder im Einstellungsbereich eine Loeschung des Server-Profils anstossen.',
  acceptLabel: 'Profil-Studio-Bedingungen akzeptieren',
  contentLicenceTitle: '6. Lizenz fuer oeffentliche Galerie-Inhalte',
  contentLicenceBody:
    'Du behaeltst alle Rechte, die du rechtlich an deinem Werk hast. Vor einem oeffentlichen Upload bestaetigst du, dass du die noetigen Rechte besitzt, und erteilst Emoji Painter eine weltweite, nicht-exklusive, gebuehrenfreie Lizenz zum Hosten, Speichern, Vervielfaeltigen, Anzeigen, Verteilen, Moderieren, Bewerben und Weiteranzeigen des Beitrags. Diese Lizenz kann fuer bereits oeffentlich eingereichte Inhalte nach der Profil-Loeschung fortbestehen; der Beitrag wird anonymisiert. Emoji Painter darf Inhalte nach eigenem Ermessen entfernen. Fuer besondere Anfragen zur Entfernung kontaktiere den Support.',
  openReaderLabel: 'Bedingungen lesen',
  closeLabel: 'Schliessen',
  privacyButtonLabel: 'Datenschutz & AGB',
  deleteButtonLabel: 'Profil vom Server loeschen',
  syncFoundTitle: 'Server-Profil gefunden',
  syncFoundBody:
    'Auf dem Server wurde ein Profil mit deiner Geraete-ID gefunden. Du kannst den gespeicherten Namen und die Pass-Bildhistorie synchronisieren, auf diesem Geraet neu starten oder das Server-Profil zuerst loeschen.',
  syncLabel: 'Synchronisieren',
  newLabel: 'Neu starten',
  deleteLabel: 'Auf Server loeschen',
  sections: [
    {
      heading: '1. Welche Daten gespeichert werden',
      body: [
        'Im Profil Studio werden eine zufaellige geraetebezogene Kennung, dein gewaehltеr Passname, gesammelte Punkte oder Coins, Strich- und Zeit-Summen sowie Passbilder gespeichert, die du in die Galerie hochlaedst.',
        'Direkt identifizierende Echtdaten wie Klarname, Anschrift oder Telefonnummer sollen nicht gespeichert werden, ausser wenn du solche Daten selbst als Profilnamen eingibst.',
      ],
    },
    {
      heading: '2. Zweck der Verarbeitung',
      body: [
        'Die Daten werden ausschliesslich genutzt, um dein Profil wiederherzustellen, deinen oeffentlichen Pass in Galerie oder Leaderboard anzuzeigen und die Profilstatistik zwischen lokalem Speicher und Server abzugleichen.',
        'Die Daten werden nicht verkauft, nicht vermietet und nicht zu Werbezwecken weitergegeben.',
      ],
    },
    {
      heading: '3. Oeffentliche Sichtbarkeit',
      body: [
        'Wenn du in die Live-Galerie hochlaedst, koennen dein Passname, dein Passbild und dein Galerie-Beitrag fuer andere Spieler sichtbar sein.',
        'Bitte verwende im Profil Studio keine sensiblen personenbezogenen Daten oder Bilder, die du nicht oeffentlich zeigen willst.',
      ],
    },
    {
      heading: '4. Rechtsgrundlage und Einwilligung',
      body: [
        'Bei Funktionen mit Serverspeicherung erfolgt die Nutzung auf Grundlage deiner Einwilligung sowie der technischen Erforderlichkeit, damit das Profil Studio ueberhaupt funktionieren kann.',
        'Du kannst deine Einwilligung jederzeit widerrufen, indem du das Server-Profil loeschst und mit einem neuen lokalen Profil startest.',
      ],
    },
    {
      heading: '5. Deine Moeglichkeiten',
      body: [
        'Du kannst ein bestehendes Server-Profil in eine frische Installation zurueckholen, mit einer neuen Geraete-ID lokal neu starten oder eine Loeschung des Server-Profils anfordern, sobald der Loesch-Endpunkt verfuegbar ist.',
        'Das blosse Loeschen der App kann lokale Daten entfernen, waehrend serverseitige oeffentliche Profildaten online bleiben, bis du sie gezielt synchronisierst oder loeschst.',
      ],
    },
    {
      heading: '6. Lizenz fuer oeffentliche Galerie-Inhalte',
      body: [
        'Du behaeltst alle Rechte, die du rechtlich an deinem Werk hast, und bestaetigst vor dem Upload, dass du die noetigen Rechte dafuer besitzt.',
        'Du erteilst Emoji Painter eine weltweite, nicht-exklusive, gebuehrenfreie Lizenz zum Hosten, Speichern, Vervielfaeltigen, Anzeigen, Verteilen, Moderieren, Bewerben und Weiteranzeigen oeffentlicher Galerie-Beitraege. Diese Lizenz kann fuer bereits eingereichte Inhalte nach der Profil-Loeschung fortbestehen; die Beitraege werden anonymisiert.',
        'Emoji Painter darf Inhalte nach eigenem Ermessen entfernen. Fuer besondere Anfragen zur Entfernung kannst du den Support kontaktieren.',
      ],
    },
  ],
};

const fallback = (base: ProfileTermsCopy, overrides: Partial<ProfileTermsCopy>): ProfileTermsCopy => ({
  ...base,
  ...overrides,
});

export const PROFILE_TERMS_COPY: Record<InfoLanguage, ProfileTermsCopy> = {
  en,
  de,
  ru: fallback(en, {
    title: 'Profil Studio Terms',
    privacyButtonLabel: 'Privacy & Terms',
    openReaderLabel: 'Read Terms',
    acceptLabel: 'Accept Terms',
  }),
  zh: fallback(en, {
    title: 'Profil Studio Terms',
    privacyButtonLabel: 'Privacy & Terms',
    openReaderLabel: 'Read Terms',
    acceptLabel: 'Accept Terms',
  }),
  ko: fallback(en, {
    title: 'Profil Studio Terms',
    privacyButtonLabel: 'Privacy & Terms',
    openReaderLabel: 'Read Terms',
    acceptLabel: 'Accept Terms',
  }),
  ja: fallback(en, {
    title: 'Profil Studio Terms',
    privacyButtonLabel: 'Privacy & Terms',
    openReaderLabel: 'Read Terms',
    acceptLabel: 'Accept Terms',
  }),
  fr: fallback(en, {
    title: 'Conditions Profil Studio',
    privacyButtonLabel: 'Confidentialite & CGU',
    openReaderLabel: 'Lire les conditions',
    acceptLabel: 'Accepter les conditions',
  }),
  it: fallback(en, {
    title: 'Termini Profil Studio',
    privacyButtonLabel: 'Privacy & Termini',
    openReaderLabel: 'Leggi i termini',
    acceptLabel: 'Accetta i termini',
  }),
};

export const getProfileTermsCopy = (language: InfoLanguage): ProfileTermsCopy =>
  PROFILE_TERMS_COPY[language] ?? PROFILE_TERMS_COPY.en;
