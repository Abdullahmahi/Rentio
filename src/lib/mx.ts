/** The 32 federal entities, in the order Mexican forms list them. */
export const MEXICAN_STATES = [
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche",
  "Chiapas", "Chihuahua", "Ciudad de México", "Coahuila", "Colima", "Durango",
  "Estado de México", "Guanajuato", "Guerrero", "Hidalgo", "Jalisco",
  "Michoacán", "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla",
  "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora",
  "Tabasco", "Tamaulipas", "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas",
] as const;

export const PHONE_HINT = "+52 55 1234 5678";

/** RFC for a persona física is 13 chars, moral 12. Loose on purpose — it is
 *  optional in v1 and we would rather store a slightly odd value than block. */
export function isPlausibleRfc(value: string) {
  return /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/i.test(value.trim());
}
