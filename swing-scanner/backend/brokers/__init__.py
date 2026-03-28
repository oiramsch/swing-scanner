from backend.brokers.base import BrokerConnector
from backend.brokers.alpaca import AlpacaConnector
from backend.brokers.trade_republic import TRConnector
from backend.brokers.ibkr import IBKRConnector


def get_connector(broker_connection: dict) -> BrokerConnector:
    """
    Factory: return the right BrokerConnector for a BrokerConnection record.
    broker_connection is a dict with at least broker_type, label, is_paper.
    """
    bt = broker_connection.get("broker_type", "alpaca")
    if bt == "alpaca":
        return AlpacaConnector(broker_connection)
    if bt == "trade_republic":
        return TRConnector(broker_connection)
    if bt == "ibkr":
        return IBKRConnector(broker_connection)
    raise ValueError(f"Unbekannter Broker-Typ: {bt}")


__all__ = ["BrokerConnector", "AlpacaConnector", "TRConnector", "IBKRConnector", "get_connector"]
