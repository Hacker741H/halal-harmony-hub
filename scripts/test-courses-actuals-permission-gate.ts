// AUDIT TOTAL (symptôme 2) : la visibilité du bouton "Corriger les données"
// (src/routes/_authenticated/courses/$courseId.tsx) doit refléter exactement
// la règle de permission_require côté RPC (update_transport_mission_actuals,
// supabase/migrations/20260813143000_add_real_course_pricing_and_simplify_
// workflow.sql, lignes ~156-165) :
//   IF status IN ('COMPLETED', 'CLOSED') THEN permission_require('deliveries.correct')
//   ELSE requiert missions.update OU deliveries.confirm
// -- vérifié faux en production avant correctif : le bouton s'affichait dès
// que l'utilisateur avait missions.update OU deliveries.correct, sur tout
// statut non-CANCELLED, sans distinguer avant/après finalisation. Un
// utilisateur avec missions.update seul (rôles gestionnaire/operations, tous
// deux réellement accordés en production, gestionnaire réellement attribué à
// un utilisateur) voyait le bouton sur une Course COMPLETED/CLOSED puis
// recevait 42501 en soumettant.
//
// Ce script mirrore littéralement la condition JSX du fichier -- si la
// condition est un jour modifiée sans modifier ce mirroir (ou l'inverse),
// relire les deux côte à côte avant de faire confiance à ce test.
import assert from "node:assert/strict";

type CourseStatus = "DRAFT" | "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CLOSED" | "CANCELLED";

function canShowCorrigerLesDonnees(
  status: CourseStatus,
  permissions: { missionsUpdate: boolean; deliveriesCorrect: boolean; deliveriesConfirm: boolean },
): boolean {
  if (status === "CANCELLED") return false;
  if (status === "COMPLETED" || status === "CLOSED") return permissions.deliveriesCorrect;
  return permissions.missionsUpdate || permissions.deliveriesConfirm;
}

function expect(condition: unknown, message: string): asserts condition {
  assert.equal(condition, true, message);
}

function run(): void {
  // 1. Le cas réel du bug : gestionnaire/operations (missions.update seul,
  // sans deliveries.correct) sur une Course finalisée. Avant correctif : true
  // (bouton visible) -- doit désormais être false.
  expect(
    canShowCorrigerLesDonnees("COMPLETED", {
      missionsUpdate: true,
      deliveriesCorrect: false,
      deliveriesConfirm: false,
    }) === false,
    "missions.update seul sur une Course COMPLETED ne doit plus afficher le bouton -- c'est exactement le bug trouvé en production (rôle gestionnaire réellement attribué).",
  );
  expect(
    canShowCorrigerLesDonnees("CLOSED", {
      missionsUpdate: true,
      deliveriesCorrect: false,
      deliveriesConfirm: false,
    }) === false,
    "même règle sur CLOSED : missions.update seul ne suffit plus une fois finalisée.",
  );

  // 2. admin/super_admin (deliveries.correct) reste toujours capable de
  // corriger une Course finalisée -- c'est le seul chemin qui doit rester ouvert.
  expect(
    canShowCorrigerLesDonnees("COMPLETED", {
      missionsUpdate: false,
      deliveriesCorrect: true,
      deliveriesConfirm: false,
    }) === true,
    "deliveries.correct doit continuer à afficher le bouton sur une Course COMPLETED.",
  );
  expect(
    canShowCorrigerLesDonnees("CLOSED", {
      missionsUpdate: false,
      deliveriesCorrect: true,
      deliveriesConfirm: false,
    }) === true,
    "deliveries.correct doit continuer à afficher le bouton sur une Course CLOSED.",
  );

  // 3. Avant finalisation, la règle de la RPC est missions.update OU
  // deliveries.confirm -- les deux doivent afficher le bouton (le second cas
  // n'était pas du tout vérifié par l'ancienne condition).
  expect(
    canShowCorrigerLesDonnees("IN_PROGRESS", {
      missionsUpdate: true,
      deliveriesCorrect: false,
      deliveriesConfirm: false,
    }) === true,
    "missions.update doit afficher le bouton avant finalisation (IN_PROGRESS).",
  );
  expect(
    canShowCorrigerLesDonnees("PLANNED", {
      missionsUpdate: false,
      deliveriesCorrect: false,
      deliveriesConfirm: true,
    }) === true,
    "deliveries.confirm seul doit aussi afficher le bouton avant finalisation -- la RPC l'accepte, l'ancienne condition frontend ne le vérifiait pas du tout.",
  );

  // 4. Sans aucune des permissions pertinentes, jamais de bouton, quel que
  // soit le statut non-annulé.
  expect(
    canShowCorrigerLesDonnees("DRAFT", {
      missionsUpdate: false,
      deliveriesCorrect: false,
      deliveriesConfirm: false,
    }) === false,
    "aucune permission pertinente : le bouton ne doit jamais apparaître.",
  );

  // 5. CANCELLED reste l'exception absolue, peu importe les permissions --
  // règle inchangée par ce correctif.
  expect(
    canShowCorrigerLesDonnees("CANCELLED", {
      missionsUpdate: true,
      deliveriesCorrect: true,
      deliveriesConfirm: true,
    }) === false,
    "CANCELLED ne doit jamais afficher le bouton, même avec toutes les permissions.",
  );

  console.log("Courses actuals permission-gate tests passed.");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
