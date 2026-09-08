import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  createEmployee,
  updateEmployee,
  type Employee,
} from "@/lib/employees.functions";
import { notifyMutationError } from "@/lib/notify-mutation-error";

type Props = {
  employee?: Employee | null;
  onSuccess: () => void;
};

export function EmployeeForm({
  employee,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
  nom: employee?.nom ?? "",
  prenom: employee?.prenom ?? "",
  telephone: employee?.telephone ?? "",
  email: employee?.email ?? "",
  poste: employee?.poste ?? "",
  salaire_base: employee?.salaire_base?.toString() ?? "",
  matricule: employee?.matricule ?? "",
  date_embauche: employee?.date_embauche ?? "",
});

  async function save() {
  if (!form.nom.trim()) {
    toast.error("Le nom est obligatoire.");
    return;
  }

  try {
    setLoading(true);

    const values = {
      nom: form.nom.trim(),
      prenom: form.prenom.trim() || null,
      telephone: form.telephone.trim() || null,
      email: form.email.trim() || null,
      poste: form.poste.trim() || null,
      matricule: form.matricule.trim() || null,
      salaire_base: form.salaire_base
        ? Number(form.salaire_base)
        : null,
      date_embauche: form.date_embauche || null,
      statut: "actif" as const,
    };

    if (employee) {
      await updateEmployee({
        data: {
          id: employee.id,
          values,
        },
      });

      toast.success("Employé modifié avec succès.");
    } else {
      await createEmployee({
        data: values,
      });

      toast.success("Employé enregistré avec succès.");
    }

    setForm({
      nom: "",
      prenom: "",
      telephone: "",
      email: "",
      poste: "",
      salaire_base: "",
      matricule: "",
      date_embauche: "",
    });

    onSuccess();
  } catch (error) {
    console.error(error);

    notifyMutationError(error, "Une erreur est survenue pendant l'enregistrement.");
  } finally {
    setLoading(false);
  }
}

  return (
    <div className="space-y-4">

      <div>
        <Label>Nom</Label>
        <Input
          value={form.nom}
          onChange={(e) =>
            setForm({
              ...form,
              nom: e.target.value,
            })
          }
        />
      </div>

      <div>
        <Label>Prénom</Label>
        <Input
          value={form.prenom}
          onChange={(e) =>
            setForm({
              ...form,
              prenom: e.target.value,
            })
          }
        />
      </div>

      <div>
        <Label>Téléphone</Label>
        <Input
          value={form.telephone}
          onChange={(e) =>
            setForm({
              ...form,
              telephone: e.target.value,
            })
          }
        />
      </div>

      <div>
        <Label>Email</Label>
        <Input
          type="email"
          value={form.email}
          onChange={(e) =>
            setForm({
              ...form,
              email: e.target.value,
            })
          }
        />
      </div>

      <div>
        <Label>Poste</Label>
        <Input
          value={form.poste}
          onChange={(e) =>
            setForm({
              ...form,
              poste: e.target.value,
            })
          }
        />
      </div>

      <div>
        <Label>Matricule</Label>
        <Input
          value={form.matricule}
          onChange={(e) =>
            setForm({
              ...form,
              matricule: e.target.value,
            })
          }
        />
      </div>

      <div>
        <Label>Salaire de base</Label>
        <Input
          type="number"
          value={form.salaire_base}
          onChange={(e) =>
            setForm({
              ...form,
              salaire_base: e.target.value,
            })
          }
        />
      </div>

      <div>
        <Label>Date d'embauche</Label>
        <Input
          type="date"
          value={form.date_embauche}
          onChange={(e) =>
            setForm({
              ...form,
              date_embauche: e.target.value,
            })
          }
        />
      </div>

      <Button
        className="w-full"
        disabled={loading}
        onClick={save}
      >
        {loading ? "Enregistrement..." : "Enregistrer"}
      </Button>

    </div>
  );
}
