/**
 * Population generation source material.
 *
 * Names are grouped by cultural region and drawn according to the country an
 * agent is generated in, so a world seeded with Lagos, Seoul and Munich reads
 * like those places rather than like a US phone book.
 */

export interface NamePool {
  male: string[];
  female: string[];
  family: string[];
}

export const NAME_POOLS: Record<string, NamePool> = {
  western: {
    male: ['James', 'Oliver', 'Henry', 'Noah', 'Leo', 'Theo', 'Adam', 'Callum', 'Felix', 'Rory', 'Jonah', 'Miles'],
    female: ['Ava', 'Freya', 'Iris', 'Nora', 'Maya', 'Elena', 'Clara', 'Sadie', 'Robin', 'Thea', 'Juno', 'Wren'],
    family: ['Whitmore', 'Hale', 'Okonjo', 'Bennett', 'Ashcroft', 'Vance', 'Ferris', 'Rowntree', 'Sallow', 'Marsh', 'Kingsley', 'Doyle'],
  },
  hispanic: {
    male: ['Mateo', 'Diego', 'Santiago', 'Tomás', 'Rafael', 'Emilio', 'Bruno', 'Iker'],
    female: ['Sofía', 'Valentina', 'Lucía', 'Camila', 'Renata', 'Paloma', 'Ximena', 'Aitana'],
    family: ['Reyes', 'Salazar', 'Moreno', 'Cabrera', 'Iglesias', 'Ferrer', 'Duarte', 'Quintana'],
  },
  arabic: {
    male: ['Omar', 'Karim', 'Yusuf', 'Tariq', 'Rami', 'Hadi', 'Zayd', 'Nabil'],
    female: ['Layla', 'Amira', 'Nadia', 'Salma', 'Rania', 'Yasmin', 'Dalia', 'Hana'],
    family: ['Haddad', 'Nassar', 'Khalil', 'Mansour', 'Rahmani', 'Sabbagh', 'Zahran', 'Farouk'],
  },
  southAsian: {
    male: ['Arjun', 'Rohan', 'Vikram', 'Aditya', 'Imran', 'Kabir', 'Dev', 'Rehan'],
    female: ['Priya', 'Ananya', 'Meera', 'Zara', 'Ishani', 'Divya', 'Noor', 'Anika'],
    family: ['Sharma', 'Iyer', 'Chowdhury', 'Bhatt', 'Raghunathan', 'Qureshi', 'Menon', 'Sethi'],
  },
  eastAsian: {
    male: ['Wei', 'Haruto', 'Minjun', 'Jian', 'Ren', 'Sung', 'Kenji', 'Zhao'],
    female: ['Mei', 'Yuki', 'Sora', 'Jia', 'Hyejin', 'Lin', 'Aiko', 'Nari'],
    family: ['Chen', 'Tanaka', 'Park', 'Nakamura', 'Zhou', 'Kim', 'Sato', 'Huang'],
  },
  african: {
    male: ['Kwame', 'Chidi', 'Tendai', 'Musa', 'Kofi', 'Sipho', 'Abel', 'Jabari'],
    female: ['Amara', 'Zola', 'Nneka', 'Thandi', 'Aisha', 'Chioma', 'Lerato', 'Efua'],
    family: ['Adeyemi', 'Mensah', 'Nkosi', 'Achebe', 'Diallo', 'Mwangi', 'Osei', 'Banda'],
  },
  slavic: {
    male: ['Dmitri', 'Luka', 'Aleksei', 'Marek', 'Ivan', 'Pavel', 'Tomasz', 'Milan'],
    female: ['Katya', 'Zofia', 'Milena', 'Anya', 'Irina', 'Lena', 'Dasha', 'Vera'],
    family: ['Volkov', 'Novak', 'Petrov', 'Kowalski', 'Marek', 'Sokolov', 'Havel', 'Dragić'],
  },
};

/** Country code → which name pool a generated resident is likely drawn from. */
export const REGION_BY_COUNTRY: Record<string, string> = {
  GB: 'western', US: 'western', CA: 'western', AU: 'western', IE: 'western', NZ: 'western',
  DE: 'western', NL: 'western', SE: 'western', NO: 'western', DK: 'western', FI: 'western',
  FR: 'western', BE: 'western', CH: 'western', AT: 'western',
  ES: 'hispanic', MX: 'hispanic', AR: 'hispanic', CL: 'hispanic', CO: 'hispanic', PE: 'hispanic', BR: 'hispanic', PT: 'hispanic',
  AE: 'arabic', SA: 'arabic', EG: 'arabic', QA: 'arabic', MA: 'arabic', JO: 'arabic', LB: 'arabic', TR: 'arabic',
  IN: 'southAsian', PK: 'southAsian', BD: 'southAsian', LK: 'southAsian', NP: 'southAsian',
  CN: 'eastAsian', JP: 'eastAsian', KR: 'eastAsian', TW: 'eastAsian', SG: 'eastAsian', HK: 'eastAsian', VN: 'eastAsian', TH: 'eastAsian',
  NG: 'african', KE: 'african', ZA: 'african', GH: 'african', ET: 'african', TZ: 'african', SN: 'african',
  RU: 'slavic', PL: 'slavic', UA: 'slavic', CZ: 'slavic', RS: 'slavic', HR: 'slavic', RO: 'slavic',
};

export interface OccupationTemplate {
  title: string;
  sector: string;
  /** Multiplier applied to the city's median salary. */
  payBand: number;
  /** Skills this job builds, and the education it usually requires. */
  skills: string[];
  education: string[];
  /** Weight in the general population. */
  frequency: number;
}

export const OCCUPATIONS: OccupationTemplate[] = [
  { title: 'Software Engineer', sector: 'technology', payBand: 1.9, skills: ['programming', 'systems-design', 'debugging'], education: ['BSc Computer Science', 'Self-taught', 'MSc Computer Science'], frequency: 9 },
  { title: 'Machine Learning Researcher', sector: 'technology', payBand: 2.6, skills: ['machine-learning', 'mathematics', 'research'], education: ['PhD Machine Learning', 'MSc Artificial Intelligence'], frequency: 3 },
  { title: 'Founder', sector: 'technology', payBand: 0.8, skills: ['fundraising', 'sales', 'product', 'recruiting'], education: ['BSc Computer Science', 'Dropout', 'MBA'], frequency: 3 },
  { title: 'Product Manager', sector: 'technology', payBand: 1.8, skills: ['product', 'communication', 'analysis'], education: ['BA Economics', 'BSc Engineering', 'MBA'], frequency: 4 },
  { title: 'Investment Analyst', sector: 'finance', payBand: 2.2, skills: ['finance', 'analysis', 'negotiation'], education: ['BSc Economics', 'MSc Finance'], frequency: 4 },
  { title: 'Venture Capitalist', sector: 'finance', payBand: 3.0, skills: ['finance', 'networking', 'judgement'], education: ['MBA', 'BA Philosophy Politics Economics'], frequency: 1 },
  { title: 'Doctor', sector: 'healthcare', payBand: 2.4, skills: ['medicine', 'diagnosis', 'empathy'], education: ['MBBS', 'MD'], frequency: 5 },
  { title: 'Nurse', sector: 'healthcare', payBand: 1.1, skills: ['medicine', 'care', 'stamina'], education: ['BSc Nursing'], frequency: 6 },
  { title: 'Teacher', sector: 'education', payBand: 0.9, skills: ['teaching', 'communication', 'patience'], education: ['BA Education', 'PGCE'], frequency: 7 },
  { title: 'Professor', sector: 'education', payBand: 1.5, skills: ['research', 'teaching', 'writing'], education: ['PhD'], frequency: 2 },
  { title: 'Lawyer', sector: 'legal', payBand: 2.3, skills: ['law', 'argument', 'writing'], education: ['LLB', 'JD'], frequency: 4 },
  { title: 'Civil Servant', sector: 'government', payBand: 1.1, skills: ['policy', 'administration', 'diplomacy'], education: ['BA Politics', 'MPA'], frequency: 5 },
  { title: 'Journalist', sector: 'media', payBand: 0.9, skills: ['writing', 'investigation', 'networking'], education: ['BA Journalism', 'BA English'], frequency: 3 },
  { title: 'Designer', sector: 'creative', payBand: 1.3, skills: ['design', 'creativity', 'communication'], education: ['BA Design', 'Self-taught'], frequency: 4 },
  { title: 'Musician', sector: 'creative', payBand: 0.6, skills: ['music', 'performance', 'creativity'], education: ['Conservatoire', 'Self-taught'], frequency: 2 },
  { title: 'Chef', sector: 'hospitality', payBand: 0.9, skills: ['cooking', 'management', 'stamina'], education: ['Culinary School', 'Apprenticeship'], frequency: 4 },
  { title: 'Electrician', sector: 'trades', payBand: 1.1, skills: ['electrical', 'problem-solving'], education: ['Apprenticeship'], frequency: 5 },
  { title: 'Logistics Coordinator', sector: 'industry', payBand: 1.0, skills: ['operations', 'planning'], education: ['BA Business', 'Vocational Diploma'], frequency: 5 },
  { title: 'Sales Executive', sector: 'business', payBand: 1.3, skills: ['sales', 'persuasion', 'networking'], education: ['BA Business', 'None'], frequency: 6 },
  { title: 'Data Scientist', sector: 'technology', payBand: 2.0, skills: ['statistics', 'programming', 'analysis'], education: ['MSc Statistics', 'BSc Mathematics'], frequency: 4 },
  { title: 'Student', sector: 'education', payBand: 0.15, skills: ['learning'], education: ['Undergraduate'], frequency: 8 },
  { title: 'Researcher', sector: 'science', payBand: 1.3, skills: ['research', 'writing', 'experiment-design'], education: ['PhD', 'MSc'], frequency: 3 },
  { title: 'Architect', sector: 'construction', payBand: 1.6, skills: ['design', 'engineering', 'project-management'], education: ['MArch'], frequency: 2 },
  { title: 'Unemployed', sector: 'none', payBand: 0.1, skills: [], education: ['Secondary School', 'BA'], frequency: 3 },
];

export const VALUES = [
  'freedom', 'security', 'status', 'knowledge', 'family', 'justice', 'creativity', 'wealth',
  'loyalty', 'independence', 'legacy', 'kindness', 'excellence', 'adventure', 'faith', 'honesty',
  'power', 'community', 'beauty', 'order',
];

export const INTERESTS = [
  'startups', 'artificial intelligence', 'climate', 'football', 'chess', 'cooking', 'running',
  'literature', 'cinema', 'photography', 'crypto', 'travel', 'politics', 'history', 'music',
  'fashion', 'gaming', 'philosophy', 'space', 'biotech', 'architecture', 'poker', 'cycling', 'theatre',
];

export const POLITICAL_LABELS: Array<{ label: string; economic: [number, number]; social: [number, number] }> = [
  { label: 'Progressive', economic: [-0.9, -0.2], social: [-0.9, -0.1] },
  { label: 'Social Democrat', economic: [-0.7, -0.1], social: [-0.4, 0.3] },
  { label: 'Centrist', economic: [-0.25, 0.25], social: [-0.25, 0.25] },
  { label: 'Libertarian', economic: [0.3, 0.95], social: [-0.95, -0.3] },
  { label: 'Conservative', economic: [0.1, 0.8], social: [0.1, 0.8] },
  { label: 'Nationalist', economic: [-0.2, 0.6], social: [0.4, 0.95] },
  { label: 'Apolitical', economic: [-0.15, 0.15], social: [-0.15, 0.15] },
];

export const RELIGIONS = [
  'Christianity', 'Islam', 'Hinduism', 'Buddhism', 'Judaism', 'Sikhism',
  'Secular', 'Agnostic', 'Atheist', 'Spiritual',
];

/** Which religions are plausible where — keeps generated populations coherent. */
export const RELIGION_BY_REGION: Record<string, string[]> = {
  western: ['Christianity', 'Secular', 'Agnostic', 'Atheist', 'Spiritual', 'Judaism'],
  hispanic: ['Christianity', 'Christianity', 'Secular', 'Agnostic', 'Spiritual'],
  arabic: ['Islam', 'Islam', 'Christianity', 'Secular'],
  southAsian: ['Hinduism', 'Islam', 'Sikhism', 'Christianity', 'Buddhism', 'Secular'],
  eastAsian: ['Buddhism', 'Secular', 'Atheist', 'Christianity', 'Spiritual'],
  african: ['Christianity', 'Islam', 'Spiritual', 'Secular'],
  slavic: ['Christianity', 'Atheist', 'Secular', 'Agnostic'],
};

export const EDUCATION_LEVELS = [
  'Secondary School', 'Vocational Diploma', 'Undergraduate', 'BA', 'BSc',
  'MSc', 'MBA', 'PhD', 'Self-taught', 'Dropout',
];
