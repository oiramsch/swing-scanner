# TEST FÜR DIE FABRIK
def berechne_portfolio_wert(aktien_preis: float, stueckzahl: int) -> float:
    # ACHTUNG FEHLER: float anstatt Decimal für Geldwerte genutzt!
    return aktien_preis * stueckzahl
