export interface Career {
  id: string;
  name: string;
}

export interface Plan {
  id: string;
}

export const CAREERS: Record<string, string> = {
  "B": "Ingeniería en Biotecnología",
  "BIO": "Bioingeniería",
  "C": "Ingeniería Civil",
  "I": "Ingeniería Industrial",
  "K": "Ingeniería Electrónica",
  "L": "Lic.en Administración y Sistemas",
  "LAES": "Licenciatura en Analítica Empresarial y Social",
  "LCC": "Licenciatura en Ciencias del Comportamiento",
  "LN": "Licenciatura en Negocios",
  "M": "Ingeniería Mecánica",
  "N": "Ingeniería Naval",
  "P": "Ingeniería en Petróleo",
  "Q": "Ingeniería Química",
  "S": "Ingeniería en Informática"
};

// Special career for exchanges
export const EXCHANGE_CAREER = {
  id: "X",
  name: "Intercambios"
};

export const AVAILABLE_PLANS: Record<string, Plan[]> = {
  'B': [{ id: "B 25" }],
  'BIO': [{ id: "BIO 22" }, { id: "Bio-13" }],
  'C': [{ id: "C23" }],
  'I': [{ id: "I22" }, { id: "I-13" }, { id: "I-13T" }],
  'K': [{ id: "K22" }, { id: "K07-Rev.18" }, { id: "K07A-Rev.18" }],
  'L': [{ id: "L09" }, { id: "L09-REV13" }, { id: "L09T" }],
  'LAES': [{ id: "A22" },{ id: "A17" } ],
  'LCC': [{ id: "LCC 25" }],
  'LN': [{ id: "L20" }],
  'M': [{ id: "M22" }, { id: "M09 - Rev18 (Marzo)" }, { id: "M09 - Rev18 (Agosto)" }],
  'N': [{ id: "N22" }, { id: "N18 Marzo" }, { id: "N18 Agosto" }],
  'P': [{ id: "P22" }, { id: "P05-Rev.18" }, { id: "P-13" }, { id: "P05" }],
  'Q': [{ id: "Q22" }, { id: "Q05 - Rev.18" }],
  'S': [{ id: "S10-Rev23" }, { id: "S10 - Rev18" }, { id: "S10 A - Rev18" }],
  'X': [{ id: "IN23" }]
};

// Own keys only, so a stray id like "constructor" doesn't pass.
export const isValidCareer = (careerId: string | null | undefined): careerId is string =>
  careerId != null && Object.prototype.hasOwnProperty.call(AVAILABLE_PLANS, careerId);

// Helper function to get the latest plan for a career
export const getLatestPlan = (careerId: string): string => {
  const plans = AVAILABLE_PLANS[careerId];
  return plans ? plans[0].id : '';
};

