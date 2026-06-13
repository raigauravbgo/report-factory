from fastapi import APIRouter
from pydantic import BaseModel

from schemas.interview import RecipeConfig, ValidationResult
from services import validator

router = APIRouter(prefix="/validate", tags=["validate"])


class FormulaValidationRequest(BaseModel):
    formula: str
    available_columns: list[str]


class RecipeValidationRequest(BaseModel):
    config: RecipeConfig
    available_columns: list[str]


@router.post("/kpi-formula", response_model=ValidationResult)
def validate_kpi_formula(req: FormulaValidationRequest) -> ValidationResult:
    return validator.validate_kpi_formula(req.formula, req.available_columns)


@router.post("/recipe", response_model=ValidationResult)
def validate_recipe(req: RecipeValidationRequest) -> ValidationResult:
    return validator.validate_recipe(req.config.model_dump(), req.available_columns)
