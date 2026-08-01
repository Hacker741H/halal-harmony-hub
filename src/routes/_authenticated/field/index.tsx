import { createFileRoute } from "@tanstack/react-router";

import { FieldWorkspace } from "@/components/field/field-workspace";

export const Route = createFileRoute("/_authenticated/field/")({ component: FieldWorkspace });
