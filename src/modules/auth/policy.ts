export function canAccessBusiness(role: string): boolean {
  return role === "MERCHANT" || role === "ADMIN";
}
