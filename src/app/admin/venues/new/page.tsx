import { redirect } from "next/navigation";

// Создание заведений выполняет владелец в своём кабинете.
export default function NewAdminVenuePage() {
  redirect("/admin/venues");
}
