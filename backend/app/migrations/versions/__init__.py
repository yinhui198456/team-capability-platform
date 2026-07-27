from .v0001_standard_targets import upgrade as upgrade_standard_targets

MIGRATIONS = [("0001_standard_targets", upgrade_standard_targets)]

__all__ = ["MIGRATIONS"]
