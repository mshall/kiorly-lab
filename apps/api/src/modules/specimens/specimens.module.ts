import { Module } from "@nestjs/common";

/**
 * PLACEHOLDER (KX-07 bounded context "Accession, specimens and chain of custody", requirements KLSPC*).
 * No behaviour until its build-sequence steps are scheduled; see Docs/lab-cursor-build-sequence.md.
 * SAFETY PATH (ADR-025): never gate this code behind a feature flag.
 */
@Module({})
export class SpecimensModule {}
