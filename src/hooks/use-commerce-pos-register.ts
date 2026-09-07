import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { createCommercePosId } from "@/lib/commerce-pos-session";
import {
  getCommercePosAvailableRegisters,
  openCommercePosCashSession,
} from "@/lib/commerce-pos.functions";

// CHANTIER CAISSE : plus jamais de sélection silencieuse d'"une" caisse.
// - 0 poste connu pour ce magasin -> comportement historique inchangé, zéro
//   friction, zéro appel serveur supplémentaire (registerId reste null).
// - 1 seul poste actif -> choisi automatiquement, zéro friction (aucune
//   ambiguïté à lever).
// - 2+ postes -> le dernier poste choisi sur ce navigateur est repris
//   silencieusement s'il figure toujours dans la liste ; sinon une sélection
//   explicite est requise. Un poste est verrouillé côté serveur dès qu'il
//   est retenu (open_commerce_pos_cash_session) : "occupé par quelqu'un
//   d'autre" devient détectable AVANT toute vente locale.
export type CommercePosRegister = { id: string; name: string };

export type CommercePosRegisterSelection =
  | { status: "LOADING" }
  | {
      status: "NEEDS_SELECTION";
      registers: CommercePosRegister[];
      select: (registerId: string) => void;
    }
  | {
      status: "BUSY";
      busyCashier: string;
      busySince: string | null;
      registers: CommercePosRegister[];
      retry: () => void;
      chooseAnother: () => void;
    }
  | { status: "ERROR"; message: string; retry: () => void }
  | { status: "READY"; registerId: string | null; registerName: string | null };

function storageKey(locationId: string, userId: string): string {
  return `halal_erp_pos_register:${locationId}:${userId}`;
}

function readRememberedRegisterId(locationId: string, userId: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(storageKey(locationId, userId));
  } catch {
    return null;
  }
}

function rememberRegisterId(locationId: string, userId: string, registerId: string | null): void {
  try {
    if (typeof window === "undefined") return;
    if (registerId) window.localStorage.setItem(storageKey(locationId, userId), registerId);
    else window.localStorage.removeItem(storageKey(locationId, userId));
  } catch {
    // Stockage indisponible (navigation privée, etc.) : une sélection sera
    // simplement redemandée au prochain chargement, rien de destructif.
  }
}

export function useCommercePosRegisterSelection(
  locationId: string,
  userId: string,
): CommercePosRegisterSelection {
  const registersQuery = useQuery({
    queryKey: ["commerce-pos-available-registers", locationId, userId],
    queryFn: () => getCommercePosAvailableRegisters({ data: { locationId } }),
    enabled: Boolean(locationId && userId),
  });
  // undefined = pas encore déterminé, null = mode historique (aucun poste),
  // string = poste retenu (choisi explicitement ou seul candidat possible).
  const [candidateRegisterId, setCandidateRegisterId] = useState<string | null | undefined>(
    undefined,
  );
  const [busyInfo, setBusyInfo] = useState<{ cashier: string; since: string | null } | null>(null);
  const openedForRef = useRef<string | null>(null);

  const registers = useMemo(() => registersQuery.data ?? [], [registersQuery.data]);

  // Détermine le candidat dès que la liste des postes disponibles est connue.
  useEffect(() => {
    if (!registersQuery.isSuccess || candidateRegisterId !== undefined) return;
    if (registers.length === 0) {
      setCandidateRegisterId(null);
      return;
    }
    if (registers.length === 1) {
      setCandidateRegisterId(registers[0].id);
      return;
    }
    const remembered = readRememberedRegisterId(locationId, userId);
    if (remembered && registers.some((register) => register.id === remembered)) {
      setCandidateRegisterId(remembered);
    }
    // Sinon : reste undefined -> NEEDS_SELECTION, une sélection explicite est requise.
  }, [candidateRegisterId, locationId, registers, registersQuery.isSuccess, userId]);

  const openMutation = useMutation({
    mutationFn: async (registerId: string) =>
      openCommercePosCashSession({
        data: {
          cashSessionId: createCommercePosId("cash-open-check"),
          businessLocationId: locationId,
          cashRegisterId: registerId,
          terminalId: registerId,
          openedAtDevice: new Date().toISOString(),
        },
      }),
    onSuccess: (result, registerId) => {
      if (result.status === "REGISTER_BUSY") {
        setBusyInfo({
          cashier: result.busyCashier ?? "un autre collaborateur",
          since: result.busySince ?? null,
        });
        return;
      }
      setBusyInfo(null);
      openedForRef.current = registerId;
      rememberRegisterId(locationId, userId, registerId);
    },
  });

  // Verrouille le poste choisi côté serveur -- une seule fois par candidat
  // résolu, jamais pour le mode historique (registerId null : aucun appel).
  useEffect(() => {
    if (!candidateRegisterId) return;
    if (openedForRef.current === candidateRegisterId) return;
    if (openMutation.isPending) return;
    openMutation.mutate(candidateRegisterId);
    // openMutation est intentionnellement omis des dépendances : sa
    // référence change à chaque rendu (useMutation), la rejouer sur ce
    // changement créerait une boucle. Le vrai déclencheur est candidateRegisterId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateRegisterId]);

  const retry = () => {
    if (!candidateRegisterId) return;
    setBusyInfo(null);
    openMutation.mutate(candidateRegisterId);
  };
  const chooseAnother = () => {
    setBusyInfo(null);
    openedForRef.current = null;
    rememberRegisterId(locationId, userId, null);
    setCandidateRegisterId(undefined);
  };
  const select = (registerId: string) => {
    setBusyInfo(null);
    setCandidateRegisterId(registerId);
  };

  if (registersQuery.isError) {
    return {
      status: "ERROR",
      message: "La liste des postes de caisse n’a pas pu être chargée.",
      retry: () => void registersQuery.refetch(),
    };
  }
  if (registersQuery.isPending) {
    return { status: "LOADING" };
  }
  if (candidateRegisterId === undefined) {
    // L'effet n'a pas encore résolu de candidat. Pour 0 ou 1 poste, c'est un
    // état transitoire d'un seul rendu (l'effet le résout aussitôt) -- pour
    // 2 postes ou plus sans choix mémorisé valide, c'est l'état final :
    // une sélection explicite est requise.
    return registers.length > 1
      ? { status: "NEEDS_SELECTION", registers, select }
      : { status: "LOADING" };
  }
  if (candidateRegisterId === null) {
    return { status: "READY", registerId: null, registerName: null };
  }
  if (busyInfo) {
    return {
      status: "BUSY",
      busyCashier: busyInfo.cashier,
      busySince: busyInfo.since,
      registers,
      retry,
      chooseAnother,
    };
  }
  if (openMutation.isError) {
    return {
      status: "ERROR",
      message:
        openMutation.error instanceof Error
          ? openMutation.error.message
          : "L’ouverture du poste de caisse a échoué.",
      retry,
    };
  }
  if (openedForRef.current !== candidateRegisterId) {
    return { status: "LOADING" };
  }
  const registerName =
    registers.find((register) => register.id === candidateRegisterId)?.name ?? null;
  return { status: "READY", registerId: candidateRegisterId, registerName };
}
