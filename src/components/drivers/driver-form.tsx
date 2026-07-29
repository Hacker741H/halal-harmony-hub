import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { getEmployees } from "@/lib/employees.functions";

import {
  createDriver,
  type DriverWithEmployee,
  updateDriver,
} from "@/lib/drivers.functions";

type Props = {
  driver?: DriverWithEmployee | null;
  onSuccess: () => void;
};

export function DriverForm({
  driver,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => getEmployees(),
  });

  const [form, setForm] = useState({
    employee_id: driver?.employee_id ?? "",
    numero_permis: driver?.numero_permis ?? "",
    categorie_permis: driver?.categorie_permis ?? "",
    date_expiration_permis:
      driver?.date_expiration_permis ?? "",
    notes: driver?.notes ?? "",
  });

  async function save() {
    if (!form.employee_id) {
      toast.error("Veuillez sélectionner un employé.");
      return;
    }

    try {
      setLoading(true);

      const values = {
        employee_id: form.employee_id,
        numero_permis: form.numero_permis || null,
        categorie_permis:
          form.categorie_permis || null,
        date_expiration_permis:
          form.date_expiration_permis || null,
        notes: form.notes || null,
        statut: "actif" as const,
      };

      if (driver) {
        await updateDriver({
          data: {
            id: driver.id,
            values,
          },
        });

        toast.success(
          "Chauffeur modifié avec succès."
        );
      } else {
        await createDriver({
          data: values,
        });

        toast.success(
          "Chauffeur enregistré avec succès."
        );
      }

      setForm({
        employee_id: "",
        numero_permis: "",
        categorie_permis: "",
        date_expiration_permis: "",
        notes: "",
      });

      onSuccess();
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          :
          "Une erreur est survenue."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">      <div>
        <Label>Employé</Label>

        <Select
          value={form.employee_id}
          onValueChange={(value) =>
            setForm({
              ...form,
              employee_id: value,
            })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Sélectionner un employé" />
          </SelectTrigger>

          <SelectContent>
            {employees.map((employee) => (
              <SelectItem
                key={employee.id}
                value={employee.id}
              >
                {employee.nom} {employee.prenom ?? ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Numéro de permis</Label>

        <Input
          value={form.numero_permis}
          onChange={(e) =>
            setForm({
              ...form,
              numero_permis: e.target.value,
            })
          }
        />
      </div>

      <div>
        <Label>Catégorie du permis</Label>

        <Input
          value={form.categorie_permis}
          onChange={(e) =>
            setForm({
              ...form,
              categorie_permis: e.target.value,
            })
          }
        />
      </div>

      <div>
        <Label>Date d'expiration</Label>

        <Input
          type="date"
          value={form.date_expiration_permis}
          onChange={(e) =>
            setForm({
              ...form,
              date_expiration_permis: e.target.value,
            })
          }
        />
      </div>

      <div>
        <Label>Notes</Label>

        <Input
          value={form.notes}
          onChange={(e) =>
            setForm({
              ...form,
              notes: e.target.value,
            })
          }
        />
      </div>

      <Button
        className="w-full"
        disabled={loading}
        onClick={save}
      >
        {loading
          ? "Enregistrement..."
          : driver
          ? "Modifier"
          : "Enregistrer"}
      </Button>

    </div>
  );
}
