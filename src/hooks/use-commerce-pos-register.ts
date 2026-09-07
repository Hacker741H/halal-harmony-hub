import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { createCommercePosId } from "@/lib/commerce-pos-session";
import {
  getCommercePosAvailableRegisters,
  getCommercePosOpenSessions,
  openCommercePosCashSession,
} from "@/lib/commerce-pos.functions";

// CHANTIER CAISSE : plus jamais de sélection silencieuse d'"une" caisse.
// - 0 poste actif connu pour ce magasin -> comportement historique
//   inchangé, zéro friction, zéro appel serveur supplémentaire (registerId
//   reste null).
// - 1 seul poste actif -> choisi automatiquement, zéro friction (aucune
//   ambiguïté à lever). Un poste inactif ne compte jamais comme candidat.
// - 2+ postes actifs -> le dernier poste choisi sur ce navigateur est
//   repris silencieusement s'il figure toujours parmi les actifs ; sinon
//   une sélection explicite est requise. Un poste est verrouillé côté
//   serveur dès qu'il est retenu (open_commerce_pos_cash_session) :
//   "occupé par quelqu'un d'autre" devient détectable AVANT toute vente
//   locale.
// - Écran "occupé" : Réessayer ET Choisir une autre caisse, toujours les
//   deux -- un poste occupé n'empêche jamais d'accéder aux autres.
export type CommercePosRegisterOccupancy = { cashier: string; since: string } | null;

export type CommercePosRegister = {
  id: string;
  name: string;
  isActive: boolean;
  occupiedBy: CommercePosRegisterOccupancy;
};

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
  // Qui a quel poste ouvert, depuis quand -- déjà écrite pour la
  // visibilité gestionnaire (get_commerce_pos_open_sessions), jamais
  // encore branchée à un écran avant cet écran de choix. Rafraîchie
  // périodiquement : un affichage "occupé" un peu daté n'est jamais
  // dangereux -- l'ouverture réelle revérifie toujours côté serveur au
  // moment du clic (open_commerce_pos_cash_session).
  const openSessionsQuery = useQuery({
    queryKey: ["commerce-pos-open-sessions", locationId],
    queryFn: () => getCommercePosOpenSessions({ data: { locationId } }),
    enabled: Boolean(locationId && userId),
    refetchInterval: 15_000,
  });
  // undefined = pas encore déterminé, null = mode historique (aucun poste
  // actif), string = poste retenu (choisi explicitement ou seul candidat
  // actif possible).
  const [candidateRegisterId, setCandidateRegisterId] = useState<string | null | undefined>(
    undefined,
  );
  const [busyInfo, setBusyInfo] = useState<{ cashier: string; since: string | null } | null>(null);
  // "Choisir une autre caisse" doit toujours ramener à l'écran de choix,
  // même s'il n'y a qu'un seul poste actif (celui-là même qui est occupé)
  // -- sans ce drapeau, l'effet ci-dessous re-résoudrait aussitôt le même
  // candidat unique et renverrait silencieusement à l'état BUSY.
  const [forceManualSelection, setForceManualSelection] = useState(false);
  const openedForRef = useRef<string | null>(null);

  const rawRegisters = useMemo(() => registersQuery.data ?? [], [registersQuery.data]);
  // Seuls les postes ACTIFS comptent pour la décision d'auto-sélection
  // (0/1/2+) -- un poste inactif est visible pour contexte dans l'écran de
  // choix, jamais un candidat auto-sélectionnable ni un blocage vers
  // l'auto-sélection à poste unique.
  const activeRegisters = useMemo(
    () => rawRegisters.filter((register) => register.isActive),
    [rawRegisters],
  );
  const enrichedRegisters = useMemo<CommercePosRegister[]>(() => {
    const openByRegisterId = new Map(
      (openSessionsQuery.data ?? [])
        .filter((session): session is typeof session & { cashRegisterId: string } =>
          Boolean(session.cashRegisterId),
        )
        .map((session) => [session.cashRegisterId, session]),
    );
    return rawRegisters.map((register) => {
      const open = openByRegisterId.get(register.id);
      return {
        id: register.id,
        name: register.name,
        isActive: register.isActive,
        occupiedBy: open ? { cashier: open.cashier, since: open.openedAtServer } : null,
      };
    });
  }, [rawRegisters, openSessionsQuery.data]);

  // Détermine le candidat dès que la liste des postes actifs est connue.
  useEffect(() => {
    if (!registersQuery.isSuccess || candidateRegisterId !== undefined) return;
    if (forceManualSelection) return;
    if (activeRegisters.length === 0) {
      setCandidateRegisterId(null);
      return;
    }
    if (activeRegisters.length === 1) {
      setCandidateRegisterId(activeRegisters[0].id);
      return;
    }
    const remembered = readRememberedRegisterId(locationId, userId);
    if (remembered && activeRegisters.some((register) => register.id === remembered)) {
      setCandidateRegisterId(remembered);
    }
    // Sinon : reste undefined -> NEEDS_SELECTION, une sélection explicite est requise.
  }, [
    candidateRegisterId,
    locationId,
    activeRegisters,
    registersQuery.isSuccess,
    userId,
    forceManualSelection,
  ]);

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
  // Retour à l'écran de choix du MÊME magasin -- locationId/userId
  // n'étant jamais réinitialisés ici, la caisse ne se déplace jamais vers
  // un autre magasin en cliquant "Choisir une autre caisse".
  const chooseAnother = () => {
    setBusyInfo(null);
    openedForRef.current = null;
    rememberRegisterId(locationId, userId, null);
    setForceManualSelection(true);
    setCandidateRegisterId(undefined);
  };
  const select = (registerId: string) => {
    // Garde défensive : l'UI ne rend déjà cliquables que les postes actifs
    // et libres, mais un poste occupé ou inactif ne doit jamais pouvoir
    // être ouvert même si cette fonction était appelée autrement.
    const target = enrichedRegisters.find((register) => register.id === registerId);
    if (!target || !target.isActive || target.occupiedBy) return;
    setBusyInfo(null);
    setForceManualSelection(false);
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
    // L'effet n'a pas encore résolu de candidat. Pour 0 ou 1 poste actif
    // (hors forceManualSelection), c'est un état transitoire d'un seul
    // rendu (l'effet le résout aussitôt) -- pour 2 postes actifs ou plus
    // sans choix mémorisé valide, ou après un "Choisir une autre caisse"
    // explicite, c'est l'état final : une sélection explicite est requise.
    return activeRegisters.length > 1 || forceManualSelection
      ? { status: "NEEDS_SELECTION", registers: enrichedRegisters, select }
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
      registers: enrichedRegisters,
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
    enrichedRegisters.find((register) => register.id === candidateRegisterId)?.name ?? null;
  return { status: "READY", registerId: candidateRegisterId, registerName };
}
