"""Data contracts for Breez's delivery concierge and route simulation."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator


MissionField = Literal["origin", "destination", "cargo", "timing"]
DeliveryTiming = Literal["As soon as possible", "Within one hour"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CargoItem(Contract):
    name: str = Field(min_length=1, max_length=120)
    quantity: int = Field(strict=True, ge=1, le=99)
    options: list[str] = Field(max_length=10)


class ExtractedMission(Contract):
    """The model extracts names and intent. Breez resolves locations separately."""

    origin: str | None = Field(min_length=1, max_length=240)
    destination: str | None = Field(min_length=1, max_length=240)
    cargo: list[CargoItem] | None = Field(min_length=1, max_length=30)
    timing: DeliveryTiming | None


class ConciergeRequest(Contract):
    message: str = Field(min_length=1, max_length=1000)
    previous: ExtractedMission | None


class Coordinates(Contract):
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon: float = Field(ge=-180, le=180, allow_inf_nan=False)


class Place(Coordinates):
    name: str = Field(min_length=1, max_length=240)
    address: str = Field(max_length=300)


class MissionDraft(Contract):
    origin: Place | None
    destination: Place | None
    cargo: list[CargoItem] | None = Field(min_length=1, max_length=30)
    timing: DeliveryTiming | None

    @computed_field
    @property
    def missing_fields(self) -> list[MissionField]:
        fields: tuple[MissionField, ...] = ("origin", "destination", "cargo", "timing")
        return [field for field in fields if getattr(self, field) is None]


class ConciergeResponse(Contract):
    extracted: ExtractedMission
    draft: MissionDraft
    follow_up: str | None = Field(min_length=1, max_length=400)

    @model_validator(mode="after")
    def validate_follow_up(self):
        if bool(self.draft.missing_fields) != (self.follow_up is not None):
            raise ValueError("Ask a follow-up only when the draft has unresolved fields")
        return self


class RouteRequest(Contract):
    origin: Place
    destination: Place
    cargo: list[CargoItem] = Field(min_length=1, max_length=30)
    timing: DeliveryTiming
    confirmed: Literal[True]

    @field_validator("confirmed", mode="before")
    @classmethod
    def require_confirmation(cls, value):
        if value is not True:
            raise ValueError("Confirm the mission before simulating a route")
        return value


class SimulatedRestriction(Contract):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    center: Coordinates
    radius_miles: float = Field(gt=0, allow_inf_nan=False)


class RouteFinding(Contract):
    code: Literal["SIMULATED_RESTRICTION"]
    zone_id: str = Field(min_length=1, max_length=80)
    segment_index: int = Field(strict=True, ge=0)


class RouteResponse(Contract):
    simulation: Literal[True]
    status: Literal["passes_demo_checks", "blocked"]
    points: list[Coordinates] = Field(min_length=2)
    distance_miles: float = Field(ge=0, allow_inf_nan=False)
    eta_minutes: float | None = Field(gt=0, allow_inf_nan=False)
    assumed_speed_mph: float = Field(gt=0, allow_inf_nan=False)
    findings: list[RouteFinding]
    restrictions: list[SimulatedRestriction]

    @model_validator(mode="after")
    def validate_simulation_result(self):
        if self.status == "blocked":
            if not self.findings or self.eta_minutes is not None:
                raise ValueError("A blocked route requires findings and has no ETA")
        elif self.findings or self.eta_minutes is None:
            raise ValueError("A passing route requires an ETA and has no blocking findings")
        if any(finding.segment_index >= len(self.points) - 1 for finding in self.findings):
            raise ValueError("A finding must reference an existing route segment")
        zone_ids = {zone.id for zone in self.restrictions}
        if any(finding.zone_id not in zone_ids for finding in self.findings):
            raise ValueError("A finding must reference an existing simulated restriction")
        return self
